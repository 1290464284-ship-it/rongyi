import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Express } from 'express';
import { wrapAsync } from '../middleware';
import { AppError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { secretFileValue } from '../../infrastructure/secret-file';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { RouteDependencies } from './deps';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
// S-L8：签名 URL 有效期（毫秒）。<img> 无法携带 Authorization 头，公共 GET
// 仅对持有短期签名（≤5 分钟）的请求放行，防 URL 泄露后被长期滥用。
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

// S-L8：签名密钥派生。files 路由位于 http 层，不 import application 层
// common.ts；与 restore marker 同源派生（密钥缺失时用空密钥，使未启用
// 加密备份的环境仍能自洽校验），用途域用独立常量区分。S-L2 后 Electron
// 场景密钥经 V2_SECRET_FILE 提供（infrastructure 层读取器，密钥来源唯一）。
function fileUrlKey(): Buffer {
  const backupKey = process.env.V2_BACKUP_KEY ?? secretFileValue('backupKey') ?? '';
  if (!backupKey && process.env.NODE_ENV === 'production') {
    throw new Error('V2_BACKUP_KEY must be set in production for signed file URLs');
  }
  return createHmac('sha256', 'file-url-v1').update(backupKey).digest();
}

function signFileUrl(filename: string, exp: number): string {
  return createHmac('sha256', fileUrlKey()).update(`${filename}:${exp}`).digest('hex');
}

function verifyFileUrl(filename: string, exp: number, signature: string): boolean {
  if (!Number.isFinite(exp) || typeof signature !== 'string' || signature.length === 0) return false;
  const expected = Buffer.from(signFileUrl(filename, exp), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// S-L8：公共签名 GET（注册于 authMiddleware 之前）。仅当 query 携带有效且
// 未过期的 exp+sig 时直接发文件；否则 next() 落回受保护路由（需要 JWT）。
export function registerPublicFileRoutes(app: Express, deps: RouteDependencies): void {
  const filesDir = path.join(path.dirname(deps.dbPath), 'files');
  app.get('/api/v2/files/:name', wrapAsync((req, res, next) => {
      const name = String(req.params.name);
      if (!/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(name)) return next();
      const rawExp = req.query.exp;
      const rawSig = req.query.sig;
      const exp = typeof rawExp === 'string' ? Number(rawExp) : NaN;
      const sig = typeof rawSig === 'string' ? rawSig : '';
      // 有效窗口：exp 必须 > now 且 < now + 5 分钟（防重放与长期滥用）。
      if (!verifyFileUrl(name, exp, sig) || exp <= Date.now() || exp - Date.now() > SIGNED_URL_TTL_MS) {
        return next();
      }
      const record = deps.db.prepare(
        `SELECT id FROM FileRecord WHERE filename = ? AND deletedAt IS NULL`,
      ).get(name) as { id: string } | undefined;
      if (!record) return next();
      res.sendFile(path.join(filesDir, name), (error) => {
        if (error) next(error);
      });
  }));
}

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
           FROM FileRecord WHERE createdBy = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(context.userId, ...tenantParams(context.clinicId)) as { count: number; totalBytes: number };
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
        // 生产缺少备份密钥时先失败，避免“文件已落盘/记录已插入、签名 URL 才抛错”
        // 的半提交状态。密钥存在后再执行写入，签名步骤理论上不会再失败；若仍
        // 有异常，catch 会同时清理文件与软删 FileRecord。
        fileUrlKey();
        let recordId: string | null = null;
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
          recordId = id;
          // 配额在多实例并发下可能在写盘前通过、写盘后超限；落盘后复核一次，
          // 超限时抛错走 catch，统一软删记录并清理文件，避免配额被并发打穿。
          const usageAfter = deps.db.prepare(
            `SELECT COUNT(*) AS count, COALESCE(SUM(fileSize), 0) AS totalBytes
             FROM FileRecord WHERE createdBy = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
          ).get(context.userId, ...tenantParams(context.clinicId)) as { count: number; totalBytes: number };
          if (usageAfter.count > MAX_FILES_PER_USER || Number(usageAfter.totalBytes) > MAX_BYTES_PER_USER) {
            throw new AppError('QUOTA_EXCEEDED', 'File quota exceeded for this user', 413);
          }
          // S-L8：上传响应附带短期签名 URL，供 <img> 直接加载（无法携带 Bearer）。
          const exp = Date.now() + SIGNED_URL_TTL_MS;
          const signed = `/api/v2/files/${filename}?exp=${exp}&sig=${signFileUrl(filename, exp)}`;
          res.status(201).json({
            success: true,
            data: { id, filename, url: signed },
          });
        } catch (error) {
          if (recordId) {
            try {
              deps.db.prepare(
                `UPDATE FileRecord SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL`,
              ).run(now, now, recordId);
            } catch (cleanupError) {
              deps.logger?.warn('failed to soft-delete FileRecord after upload failure', {
                action: 'file-upload-rollback',
                recordId,
                error: cleanupError instanceof Error ? cleanupError.message : cleanupError,
              });
            }
          }
          try {
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          } catch (cleanupError) {
            deps.logger?.warn('failed to remove uploaded file after upload failure', {
              action: 'file-upload-rollback',
              filename,
              error: cleanupError instanceof Error ? cleanupError.message : cleanupError,
            });
          }
          throw error;
        }
    }),
  );

  // S-L8：受保护的签名 URL 签发端点（需 JWT；<img> 加载前由前端先换取签名）。
  app.get('/api/v2/files/:name/sign', wrapAsync((req, res) => {
      const name = String(req.params.name);
      if (!/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(name)) throw new NotFoundError('File not found');
      const context = req.context!;
      const record = deps.db.prepare(
        `SELECT id FROM FileRecord WHERE filename = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(name, ...tenantParams(context.clinicId)) as { id: string } | undefined;
      if (!record) throw new NotFoundError('File not found');
      const exp = Date.now() + SIGNED_URL_TTL_MS;
      res.json({
        success: true,
        data: { url: `/api/v2/files/${name}?exp=${exp}&sig=${signFileUrl(name, exp)}` },
      });
  }));

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

  app.delete('/api/v2/files/:name', wrapAsync((req, res) => {
      const name = String(req.params.name);
      if (!/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(name)) throw new NotFoundError('File not found');
      const context = req.context!;
      const record = deps.db.prepare(
        `SELECT id, createdBy FROM FileRecord
         WHERE filename = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(name, ...tenantParams(context.clinicId)) as { id: string; createdBy: string } | undefined;
      if (!record) throw new NotFoundError('File not found');
      if (record.createdBy !== context.userId && !['BOSS', 'ADMIN'].includes(context.role)) {
        throw new AppError('FORBIDDEN', 'Only the uploader or a BOSS can delete this file', 403);
      }
      // 先物理删除再软删记录；unlink 失败时记录保持可见，避免“记录已删但文件仍在”。
      const now = context.now().toISOString();
      deps.db.prepare(
        `UPDATE FileRecord SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL`,
      ).run(now, now, record.id);
      // 先软删记录再删物理文件：DB 更新失败时记录保持可见，绝不出现
      // “记录存在但文件已丢”；unlink 失败只留孤儿文件并告警，不影响删除语义。
      try {
        fs.rmSync(path.join(filesDir, name), { force: true });
      } catch (error) {
        deps.logger?.warn('failed to remove file after soft-delete', {
          action: 'file-delete',
          filename: name,
          error: error instanceof Error ? error.message : error,
        });
      }
      res.status(204).end();
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
