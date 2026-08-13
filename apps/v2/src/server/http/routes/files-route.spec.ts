import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerFileRoutes, registerPublicFileRoutes } from './files';
import { buildRouteDeps } from './route-deps.helper';

describe('file routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-files-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'files-route-test',
        now: () => new Date('2026-08-13T00:00:00.000Z'),
      };
      next();
    });
    registerFileRoutes(app, buildRouteDeps(db, { dbPath: path.join(dataDir, 'v2.sqlite') }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects invalid names and missing records on protected routes', async () => {
    await request(app).get('/api/v2/files/not-a-uuid.png').expect(404);
    await request(app).get('/api/v2/files/00000000-0000-0000-0000-000000000000.png').expect(404);
    await request(app).get('/api/v2/files/not-a-uuid.png/sign').expect(404);
    await request(app).delete('/api/v2/files/not-a-uuid.png').expect(404);
  });

  it('rejects invalid upload extensions and empty bodies', async () => {
    await request(app)
      .post('/api/v2/files')
      .set('x-file-name', 'bad.exe')
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(400);
    await request(app)
      .post('/api/v2/files')
      .set('x-file-name', 'valid.png')
      .set('content-type', 'image/png')
      .expect(400);
    await request(app)
      .post('/api/v2/files')
      .set('x-file-name', 'valid.png')
      .set('content-type', 'image/png')
      .send(Buffer.from('bad'))
      .expect(400);
  });

  it('creates and signs a valid png upload', async () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    const res = await request(app)
      .post('/api/v2/files')
      .set('x-file-name', 'photo.png')
      .set('content-type', 'image/png')
      .send(body)
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(String(res.body.data.url)).toMatch(/\/api\/v2\/files\/[a-f0-9-]{36}\.png\?exp=/);
    const row = db.prepare('SELECT filename FROM FileRecord WHERE filename = ?').get(res.body.data.filename) as { filename: string } | undefined;
    expect(row?.filename).toBe(res.body.data.filename);
  });

  it('falls through from the public signed file route when the record is missing', async () => {
    const publicApp = express();
    publicApp.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'public-file-test',
        now: () => new Date('2026-08-13T00:00:00.000Z'),
      };
      next();
    });
    registerPublicFileRoutes(publicApp, buildRouteDeps(db, { dbPath: path.join(dataDir, 'v2.sqlite') }));
    publicApp.use((_req, res) => res.status(404).json({ success: false }));
    await request(publicApp)
      .get('/api/v2/files/00000000-0000-0000-0000-000000000000.png?exp=1&sig=bad')
      .expect(404);
  });
});
