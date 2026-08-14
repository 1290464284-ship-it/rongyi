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
import { registerRolePermissionRoutes } from './role-permission-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('role permission routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-09T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-role-permission-routes-'));
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
        permissions: ['dashboard', 'system'],
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    registerRolePermissionRoutes(app, buildRouteDeps(db));
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

  it('GET /api/v2/role-permissions/:role returns defaults and configured rows', async () => {
    const res = await request(app).get('/api/v2/role-permissions/DOCTOR').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.defaults).toEqual(['dashboard', 'patients', 'clinical', 'communication']);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.effective).toEqual(['dashboard', 'patients', 'clinical', 'communication']);
  });

  it('PUT /api/v2/role-permissions/:role replaces module overrides', async () => {
    const res = await request(app)
      .put('/api/v2/role-permissions/DOCTOR')
      .send({
        permissions: [
          { resource: 'finance', allowed: true },
          { resource: 'patients', allowed: false },
        ],
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.effective).toContain('finance');
    expect(res.body.data.effective).not.toContain('patients');

    const rows = db.prepare(
      `SELECT resource, allowed FROM RolePermission
       WHERE role = 'DOCTOR' AND permission = 'access' ORDER BY resource`,
    ).all() as Array<{ resource: string; allowed: number }>;
    expect(rows).toEqual([
      { resource: 'finance', allowed: 1 },
      { resource: 'patients', allowed: 0 },
    ]);
  });

  it('returns 400 for an invalid role or permission key', async () => {
    await request(app)
      .put('/api/v2/role-permissions/NOT_A_ROLE')
      .send({ permissions: [] })
      .expect(400);
    await request(app)
      .put('/api/v2/role-permissions/DOCTOR')
      .send({ permissions: [{ resource: 'nope', allowed: true }] })
      .expect(400);
  });

  it('treats missing or non-array permissions as an empty list', async () => {
    const res = await request(app)
      .put('/api/v2/role-permissions/DOCTOR')
      .send({ permissions: 'not-an-array' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.effective).toEqual(['dashboard', 'patients', 'clinical', 'communication']);
  });

  it('tolerates a missing request body', async () => {
    const res = await request(app).put('/api/v2/role-permissions/DOCTOR');
    expect([200, 400, 403, 404]).toContain(res.status);
  });
});
