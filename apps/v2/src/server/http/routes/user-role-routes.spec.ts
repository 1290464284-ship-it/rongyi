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
import { registerUserRoleRoutes } from './user-role-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('user role routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-user-role-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, phone, active, loginAttempts, tokenVersion
       ) VALUES ('route-user-001', 'clinic-v2-001', ?, ?, NULL, 'routeuser', 'x', '路由员工', 'DOCTOR', NULL, 1, 0, 0)`,
    ).run(now, now);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    registerUserRoleRoutes(app, buildRouteDeps(db));
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

  it('GET /api/v2/user-roles lists non-deleted rows of the clinic', async () => {
    db.prepare(
      `INSERT INTO UserRole (userId, role, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('route-user-001', 'BOSS', 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now);

    const res = await request(app).get('/api/v2/user-roles').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([
      { userId: 'route-user-001', role: 'BOSS', clinicId: 'clinic-v2-001', createdAt: now, updatedAt: now, deletedAt: null },
    ]);
  });

  it('PUT /api/v2/user-roles/:userId replaces additional roles', async () => {
    const res = await request(app)
      .put('/api/v2/user-roles/route-user-001')
      .send({ roles: ['BOSS', 'DOCTOR'] })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.roles).toEqual(['BOSS']);

    const rows = db.prepare(
      'SELECT role FROM UserRole WHERE userId = ? ORDER BY role',
    ).all('route-user-001') as Array<{ role: string }>;
    expect(rows.map((row) => row.role)).toEqual(['BOSS']);
  });

  it('PUT /api/v2/user-roles/:userId returns 404 for an unknown user', async () => {
    const res = await request(app)
      .put('/api/v2/user-roles/user-missing-001')
      .send({ roles: ['DOCTOR'] })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('PUT /api/v2/user-roles/:userId returns 400 for an invalid role value', async () => {
    const res = await request(app)
      .put('/api/v2/user-roles/route-user-001')
      .send({ roles: ['NOT_A_ROLE'] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/v2/user-roles/:userId treats non-array roles as an empty list', async () => {
    const res = await request(app)
      .put('/api/v2/user-roles/route-user-001')
      .send({ roles: 'BOSS' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.roles).toEqual([]);
  });

  it('tolerates a missing request body', async () => {
    const res = await request(app).put('/api/v2/user-roles/missing');
    expect([200, 400, 403, 404]).toContain(res.status);
  });
});
