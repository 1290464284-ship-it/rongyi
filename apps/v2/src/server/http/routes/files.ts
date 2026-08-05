import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { wrapAsync } from '../middleware';
import { AppError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { RouteDependencies } from './deps';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

export function registerFileRoutes(app: Express, deps: RouteDependencies): void {
  const filesDir = path.join(path.dirname(deps.dbPath), 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  app.post(
    '/api/v2/files',
    express.raw({ type: () => true, limit: MAX_FILE_BYTES + 1 }),
    wrapAsync((req, res) => {
        const originalName = String(req.headers['x-file-name'] ?? '').slice(0, 255);
        const mime = String(req.headers['content-type'] ?? '');
        const extension = path.extname(originalName).toLowerCase() || extensionForMime(mime);
        if (!ALLOWED_EXTENSIONS.has(extension)) throw new ValidationError('Unsupported file type');
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ValidationError('File content is required');
        if (req.body.length > MAX_FILE_BYTES) throw new ValidationError('File exceeds 20MB limit');
        if (!validFileMagic(extension, req.body)) throw new ValidationError('File content does not match its type');
        const context = req.context!;
        const usage = deps.db.prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(fileSize), 0) AS totalBytes
           FROM FileRecord WHERE createdBy = ? AND deletedAt IS NULL`,
        ).get(context.userId) as { count: number; totalBytes: number };
        const MAX_FILES_PER_USER = 200;
        const MAX_BYTES_PER_USER = 500 * 1024 * 1024;
        if (usage.count >= MAX_FILES_PER_USER || Number(usage.totalBytes) + req.body.length > MAX_BYTES_PER_USER) {
          throw new AppError('QUOTA_EXCEEDED', 'File quota exceeded for this user', 413);
        }
        const now = context.now().toISOString();
        const patientId = typeof req.headers['x-patient-id'] === 'string' ? req.headers['x-patient-id'] : null;
        if (patientId) {
          const patient = deps.db.prepare(
            `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
          ).get(patientId, ...tenantParams(context.clinicId)) as { id: string } | undefined;
          if (!patient) throw new NotFoundError('Patient not found');
        }
        const id = randomUUID();
        const filename = `${id}${extension}`;
        const fullPath = path.join(filesDir, filename);
        try {
          fs.writeFileSync(fullPath, req.body);
          deps.db.prepare(
            `INSERT INTO FileRecord (
               id, clinicId, patientId, filename, originalName, mimeType, fileSize,
               createdBy, createdAt, updatedAt, deletedAt
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          ).run(
            id,
            context.clinicId ?? null,
            patientId,
            filename,
            originalName,
            mime,
            req.body.length,
            context.userId,
            now,
            now,
          );
        } catch (error) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          throw error;
        }
        res.status(201).json({
          success: true,
          data: { id, filename, url: `/api/v2/files/${filename}` },
        });
    }),
  );

  app.get('/api/v2/files/:name', wrapAsync((req, res, next) => {
      const name = String(req.params.name);
      if (!/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(name)) throw new NotFoundError('File not found');
      const context = req.context!;
      const record = deps.db.prepare(
        `SELECT id FROM FileRecord WHERE filename = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(name, ...tenantParams(context.clinicId)) as { id: string } | undefined;
      if (!record) throw new NotFoundError('File not found');
      res.sendFile(path.join(filesDir, name), (error) => {
        if (error) next(error);
      });
  }));
}

function extensionForMime(mime: string): string {
  if (mime.includes('image/png')) return '.png';
  if (mime.includes('image/jpeg')) return '.jpg';
  if (mime.includes('image/webp')) return '.webp';
  if (mime.includes('application/pdf')) return '.pdf';
  return '';
}

export function validFileMagic(extension: string, buffer: Buffer): boolean {
  if (extension === '.png') {
    return buffer.length >= 4
      && buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4e
      && buffer[3] === 0x47;
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === '.webp') {
    return buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  if (extension === '.pdf') {
    return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF';
  }
  /* v8 ignore next -- extension is already validated against ALLOWED_EXTENSIONS. */
  return false;
}
