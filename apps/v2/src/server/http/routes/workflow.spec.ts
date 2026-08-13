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
import { registerWorkflowRoutes } from './workflow';
import { buildRouteDeps } from './route-deps.helper';

describe('workflow routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-workflow-routes-'));
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
        traceId: 'workflow-route-test',
        now: () => new Date('2026-08-13T00:00:00.000Z'),
      };
      next();
    });
    registerWorkflowRoutes(app, buildRouteDeps(db, { dbPath: path.join(dataDir, 'v2.sqlite') }));
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

  it('normalizes absent write bodies to empty payloads', async () => {
    expect([200, 400, 404]).toContain((await request(app).post('/api/v2/appointments')).status);
    expect([200, 400, 404]).toContain((await request(app).patch('/api/v2/charges/missing/pay')).status);
    expect([200, 400, 404]).toContain((await request(app).post('/api/v2/charges/missing/refund')).status);
    expect([200, 400, 404]).toContain((await request(app).patch('/api/v2/medical-records/missing/lock')).status);
    expect([200, 400, 404]).toContain((await request(app).post('/api/v2/inventory/transactions')).status);
    expect([200, 400, 404]).toContain((await request(app).post('/api/v2/bulk-import/patients')).status);
    expect([200, 400, 404]).toContain((await request(app).post('/api/v2/follow-ups/batch-complete')).status);
    expect([200, 400, 404]).toContain((await request(app).post('/api/v2/follow-ups/batch-generate')).status);
  });

  it('validates follow-up reminder scope query values', async () => {
    await request(app).get('/api/v2/follow-ups/reminders?scope=overdue').expect(200);
    await request(app).get('/api/v2/follow-ups/reminders?scope=bad').expect(400);
    await request(app).get('/api/v2/follow-ups/reminders').expect(200);
  });
});
