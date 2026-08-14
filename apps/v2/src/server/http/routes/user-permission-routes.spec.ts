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
import { registerUserPermissionRoutes } from './user-permission-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('user permission routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-09T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-user-permission-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, phone, active, loginAttempts, tokenVersion
       ) VALUES ('route-perm-001', 'clinic-v2-001', ?, ?, NULL, 'routeperm', 'x', 'Route Perm', 'DOCTOR', NULL, 1, 0, 0)`,
    ).run(now, now);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        permissions: ['dashboard', 'system'],
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    registerUserPermissionRoutes(app, buildRouteDeps(db));
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

  it('GET /api/v2/user-permissions/:userId returns defaults and effective list', async () => {
    const res = await request(app).get('/api/v2/user-permissions/route-perm-001').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.defaults).toEqual(['dashboard', 'patients', 'clinical', 'communication']);
    expect(res.body.data.effective).toEqual(['dashboard', 'patients', 'clinical', 'communication']);
  });

  it('PUT /api/v2/user-permissions/:userId replaces overrides', async () => {
    const res = await request(app)
      .put('/api/v2/user-permissions/route-perm-001')
      .send({
        permissions: [
          { permission: 'finance', allowed: true },
          { permission: 'patients', allowed: false },
        ],
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.effective).toContain('finance');
    expect(res.body.data.effective).not.toContain('patients');

    const rows = db.prepare(
      'SELECT permission, allowed FROM UserPermission WHERE userId = ? ORDER BY permission',
    ).all('route-perm-001') as Array<{ permission: string; allowed: number }>;
    expect(rows).toEqual([
      { permission: 'finance', allowed: 1 },
      { permission: 'patients', allowed: 0 },
    ]);
  });

  it('PUT returns 404 for an unknown user and 400 for an invalid key', async () => {
    await request(app)
      .put('/api/v2/user-permissions/user-missing-001')
      .send({ permissions: [] })
      .expect(404);
    await request(app)
      .put('/api/v2/user-permissions/route-perm-001')
      .send({ permissions: [{ permission: 'nope', allowed: true }] })
      .expect(400);
  });

  it('treats missing or non-array permissions as an empty list', async () => {
    const res = await request(app)
      .put('/api/v2/user-permissions/route-perm-001')
      .send({ permissions: { invalid: true } })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.effective).toEqual(['dashboard', 'patients', 'clinical', 'communication']);
  });

  it('tolerates a missing request body', async () => {
    const res = await request(app).put('/api/v2/user-permissions/missing');
    expect([200, 400, 403, 404]).toContain(res.status);
  });
});
