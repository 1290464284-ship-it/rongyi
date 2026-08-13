import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { registerSystemRoutes } from './system';
import { buildRouteDeps } from './route-deps.helper';

describe('system routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-06T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-system-routes-'));
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
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    const sync = {
      pull: vi.fn().mockReturnValue({}),
      fullSnapshot: vi.fn().mockReturnValue({}),
      registerDevice: vi.fn().mockReturnValue({}),
      push: vi.fn().mockResolvedValue({}),
      cleanup: vi.fn().mockReturnValue({}),
      listConflicts: vi.fn().mockReturnValue([]),
      resolveConflict: vi.fn().mockResolvedValue({}),
    };
    const hr = {
      attendance: vi.fn().mockReturnValue({}),
      approveLeave: vi.fn().mockReturnValue({}),
    };
    registerSystemRoutes(app, buildRouteDeps(db, {}, { sync: sync as never, hr: hr as never }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /sync/full accepts all query filters or falls back to defaults', async () => {
    const filtered = await request(app)
      .get('/api/v2/sync/full')
      .query({ table: 'Patient', limit: '10', offset: '5', afterId: 'patient-demo-001' })
      .expect(200);
    expect(filtered.body.success).toBe(true);
    const defaults = await request(app).get('/api/v2/sync/full').expect(200);
    expect(defaults.body.success).toBe(true);
  });

  it('POST /sync/push tolerates a missing body and device header override', async () => {
    const withoutBody = await request(app).post('/api/v2/sync/push').expect(200);
    expect(withoutBody.body.success).toBe(true);
    const withHeader = await request(app)
      .post('/api/v2/sync/push')
      .set('x-device-token', 'header-token')
      .send({ deviceToken: 'body-token' })
      .expect(200);
    expect(withHeader.body.success).toBe(true);
  });

  it('POST /sync/conflicts/:id/resolve and PATCH leave approval accept string and missing bodies', async () => {
    const resolve = await request(app)
      .post('/api/v2/sync/conflicts/conflict-1/resolve')
      .send({ resolution: 'KEEP_LOCAL' })
      .expect(200);
    expect(resolve.body.success).toBe(true);
    const approve = await request(app)
      .patch('/api/v2/hr/leaves/leave-1/approve')
      .send({ approved: 'true' })
      .expect(200);
    expect(approve.body.success).toBe(true);
    const approveDefault = await request(app)
      .patch('/api/v2/hr/leaves/leave-2/approve')
      .expect(200);
    expect(approveDefault.body.success).toBe(true);
    await request(app)
      .patch('/api/v2/hr/leaves/leave-3/approve')
      .send({ approved: 'not-bool' })
      .expect(400);
  });

  it('validates retentionDays and maxKeep bounds', async () => {
    await request(app).post('/api/v2/system/audit/cleanup').send({ retentionDays: 29 }).expect(400);
    await request(app).post('/api/v2/system/audit/cleanup').send({ retentionDays: 3651 }).expect(400);
    await request(app).post('/api/v2/system/audit/cleanup').send({ retentionDays: 30 }).expect(200);
    await request(app).post('/api/v2/backups/cleanup').send({ maxKeep: 0 }).expect(400);
    await request(app).post('/api/v2/backups/cleanup').send({ maxKeep: 1 }).expect(200);
  });
});
