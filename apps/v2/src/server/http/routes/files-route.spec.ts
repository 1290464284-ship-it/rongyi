import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerFileRoutes, registerPublicFileRoutes } from './files';
import { buildRouteDeps } from './route-deps.helper';

const PNG_BODY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);

function pngUpload(app: express.Express) {
  return request(app)
    .post('/api/v2/files')
    .set('x-file-name', 'photo.png')
    .set('content-type', 'image/png')
    .send(PNG_BODY);
}

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

  it('falls through with a valid signature when the record was soft-deleted', async () => {
    const upload = await pngUpload(app).expect(201);
    const filename = String(upload.body.data.filename);
    db.prepare('UPDATE FileRecord SET deletedAt = ? WHERE filename = ?')
      .run(new Date().toISOString(), filename);
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
    await request(publicApp).get(String(upload.body.data.url)).expect(404);
  });

  it('reports sendFile failures on public and protected downloads', async () => {
    const upload = await pngUpload(app).expect(201);
    const filename = String(upload.body.data.filename);
    fs.rmSync(path.join(dataDir, 'files', filename), { force: true });
    // 保护路由：记录在但文件缺失 → sendFile error → 错误中间件
    await request(app).get(`/api/v2/files/${filename}`).expect(500);

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
    publicApp.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ success: false });
    });
    await request(publicApp).get(String(upload.body.data.url)).expect(500);
  });

  it('uploads without a clinic tenant', async () => {
    const noClinicApp = express();
    noClinicApp.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: null,
        role: 'BOSS',
        traceId: 'no-clinic-file-test',
        now: () => new Date('2026-08-13T00:00:00.000Z'),
      };
      next();
    });
    registerFileRoutes(noClinicApp, buildRouteDeps(db, { dbPath: path.join(dataDir, 'v2.sqlite') }));
    noClinicApp.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false });
    });
    const res = await pngUpload(noClinicApp).expect(201);
    const row = db.prepare('SELECT clinicId FROM FileRecord WHERE filename = ?').get(String(res.body.data.filename)) as {
      clinicId: string | null;
    };
    expect(row.clinicId).toBeNull();
  });

  it('rechecks the quota after writing and reports cleanup failures', async () => {
    const originalPrepare = db.prepare.bind(db);
    // 阶段一：软删失败(Error) + 文件清理失败(非 Error)
    let sumCalls = 0;
    const spyA = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('SUM(fileSize)')) {
        sumCalls += 1;
        if (sumCalls === 2) return { get: () => ({ count: 201, totalBytes: 0 }) } as never;
      }
      if (sql.includes('UPDATE FileRecord SET deletedAt')) {
        return { run: () => { throw new Error('soft-delete failed'); } } as never;
      }
      return originalPrepare(sql);
    });
    const spyUnlinkA = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw 'unlink-string'; });
    try {
      await pngUpload(app).expect(413);
    } finally {
      spyA.mockRestore();
      spyUnlinkA.mockRestore();
    }
    // 阶段二：软删失败(非 Error) + 文件清理失败(Error)
    sumCalls = 0;
    const spyB = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('SUM(fileSize)')) {
        sumCalls += 1;
        if (sumCalls === 2) return { get: () => ({ count: 201, totalBytes: 0 }) } as never;
      }
      if (sql.includes('UPDATE FileRecord SET deletedAt')) {
        return { run: () => { throw 'soft-delete-string'; } } as never;
      }
      return originalPrepare(sql);
    });
    const spyUnlinkB = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('unlink failed'); });
    try {
      await pngUpload(app).expect(413);
    } finally {
      spyB.mockRestore();
      spyUnlinkB.mockRestore();
    }
  });

  it('rejects deleting a missing file and tolerates unlink failures', async () => {
    await request(app).delete('/api/v2/files/00000000-0000-0000-0000-000000000000.png').expect(404);

    const first = await pngUpload(app).expect(201);
    const spyString = vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw 'rm-string'; });
    try {
      await request(app).delete(`/api/v2/files/${String(first.body.data.filename)}`).expect(204);
    } finally {
      spyString.mockRestore();
    }

    const second = await pngUpload(app).expect(201);
    const spyError = vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('rm failed'); });
    try {
      await request(app).delete(`/api/v2/files/${String(second.body.data.filename)}`).expect(204);
    } finally {
      spyError.mockRestore();
    }
  });

  it('rolls back cleanly when the file write itself fails', async () => {
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('disk full'); });
    try {
      await pngUpload(app).expect(500);
    } finally {
      spy.mockRestore();
    }
  });

  it('serves an existing file through the protected route', async () => {
    const upload = await pngUpload(app).expect(201);
    await request(app).get(`/api/v2/files/${String(upload.body.data.filename)}`).expect(200);
  });
});
