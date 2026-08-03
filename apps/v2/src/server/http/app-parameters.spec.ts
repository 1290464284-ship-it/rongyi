import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';

describe('HTTP app parameter branches', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-app-params-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    app = createApp({
      db,
      dbPath: path.join(dataDir, 'v2.sqlite'),
      backupDir: path.join(dataDir, 'backups'),
      logDir: dataDir,
      logger: new Logger({ logDir: dataDir }),
    });
    const login = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200);
    token = login.body.data.token as string;
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('covers missing and present body/query branches for auth and workflows', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);

    await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'wrong' }).expect(401);
    await request(app).post('/api/v2/auth/login').send().expect(401);
    await request(app).post('/api/v2/auth/refresh').send({ refreshToken: 'bad' }).expect(401);
    await request(app).post('/api/v2/auth/refresh').send().expect(401);
    await request(app).post('/api/v2/auth/logout').send({ refreshToken: 'bad' }).expect(200);
    await request(app).post('/api/v2/auth/logout').send().expect(200);
    await auth(request(app).patch('/api/v2/auth/password')).send({ oldPassword: 'wrong', newPassword: 'newpass123' }).expect(401);
    await auth(request(app).patch('/api/v2/auth/password')).send().expect(401);

    await auth(request(app).patch('/api/v2/appointments/appointment-demo-001/status')).send({ status: 'CANCELLED' }).expect(200);
    await auth(request(app).patch('/api/v2/appointments/appointment-demo-001/status')).send().expect(409);

    await auth(request(app).patch('/api/v2/registrations/missing/status')).send({ status: 'IN_PROGRESS' }).expect(404);
    await auth(request(app).patch('/api/v2/registrations/missing/status')).send().expect(404);
    await auth(request(app).patch('/api/v2/visits/missing/status')).send({ status: 'COMPLETED' }).expect(404);
    await auth(request(app).patch('/api/v2/visits/missing/status')).send().expect(404);
    await auth(request(app).patch('/api/v2/first-exams/missing/status')).send({ status: 'SUBMITTED' }).expect(404);
    await auth(request(app).patch('/api/v2/first-exams/missing/status')).send().expect(404);
    await auth(request(app).patch('/api/v2/treatments/missing/status')).send({ status: 'IN_PROGRESS' }).expect(404);
    await auth(request(app).patch('/api/v2/treatments/missing/status')).send().expect(404);
  });

  it('covers missing and present body branches for financial and system routes', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);

    await auth(request(app).post('/api/v2/inventory/replenishment/apply')).send({ ids: [] }).expect(400);
    await auth(request(app).post('/api/v2/inventory/replenishment/apply')).send().expect(400);
    await auth(request(app).post('/api/v2/wechat/send-batch')).send({ ids: [] }).expect(200);
    await auth(request(app).post('/api/v2/wechat/send-batch')).send().expect(200);
    await auth(request(app).post('/api/v2/print/templates/missing/render')).send({ title: 'x' }).expect(404);
    await auth(request(app).post('/api/v2/print/templates/missing/render')).send().expect(404);

    await auth(request(app).patch('/api/v2/charges/missing/pay')).send({ amount: 1, method: 'CASH' }).expect(404);
    await auth(request(app).patch('/api/v2/charges/missing/pay')).send().expect(404);
    await auth(request(app).post('/api/v2/charges/missing/refund')).send({ amount: 1, reason: 'r' }).expect(404);
    await auth(request(app).post('/api/v2/charges/missing/refund')).send().expect(404);

    await auth(request(app).post('/api/v2/member-cards/missing/recharge')).send({ amount: 1, requestId: 'param-recharge' }).expect(404);
    await auth(request(app).post('/api/v2/member-cards/missing/recharge')).send().expect(404);
    await auth(request(app).post('/api/v2/member-cards/missing/consume')).send({ amount: 1, requestId: 'param-consume' }).expect(404);
    await auth(request(app).post('/api/v2/member-cards/missing/consume')).send().expect(404);
    await auth(request(app).post('/api/v2/member-cards/missing/points')).send({ points: 1 }).expect(404);
    await auth(request(app).post('/api/v2/member-cards/missing/points')).send({ points: 1, requestId: 'param-points' }).expect(404);
    await auth(request(app).post('/api/v2/member-cards/missing/points')).send().expect(404);

    await auth(request(app).patch('/api/v2/debts/missing/pay')).send({ amount: 1, requestId: 'param-debt' }).expect(404);
    await auth(request(app).patch('/api/v2/debts/missing/pay')).send({ amount: 1 }).expect(404);
    await auth(request(app).patch('/api/v2/debts/missing/pay')).send().expect(404);
    await auth(request(app).patch('/api/v2/processing-orders/missing/status')).send({ status: 'SENT' }).expect(404);
    await auth(request(app).patch('/api/v2/processing-orders/missing/status')).send().expect(404);
    await auth(request(app).post('/api/v2/bulk-import/patients')).send({ rows: [] }).expect(200);
    await auth(request(app).post('/api/v2/bulk-import/patients')).send().expect(200);

    await auth(request(app).post('/api/v2/inventory/transactions')).send({ itemId: 'inventory-demo-001', type: 'IN', quantity: 1, requestId: 'param-inventory' }).expect(201);
    await auth(request(app).post('/api/v2/inventory/transactions')).send({ itemId: 'inventory-demo-001', type: 'IN', quantity: 1 }).expect(201);
    await auth(request(app).get('/api/v2/inventory/expiring?days=30')).expect(200);
    await auth(request(app).get('/api/v2/inventory/expiring?days=abc')).expect(200);
    await auth(request(app).get('/api/v2/inventory/expiring')).expect(200);
    await auth(request(app).post('/api/v2/follow-ups/batch-generate')).send({ limit: 1 }).expect(200);
    await auth(request(app).post('/api/v2/follow-ups/batch-generate')).send().expect(200);
  });

  it('covers query and body defaults for stats, print, sync, HR, alerts, backups, and search', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);

    await auth(request(app).get('/api/v2/stats/revenue')).expect(200);
    await auth(request(app).get('/api/v2/stats/revenue?startDate=2026-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z')).expect(200);
    await auth(request(app).get('/api/v2/stats/patient-growth')).expect(200);
    await auth(request(app).get('/api/v2/stats/patient-growth?startDate=2026-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z')).expect(200);

    await auth(request(app).get('/api/v2/print?kind=report&data=%7B%22title%22%3A%22T%22%7D')).expect(200);
    await auth(request(app).get('/api/v2/print')).expect(200);
    await auth(request(app).get('/api/v2/sync/pull?since=2026-01-01T00:00:00.000Z&deviceId=test')).expect(200);
    await auth(request(app).get('/api/v2/sync/pull')).expect(200);
    await auth(request(app).post('/api/v2/sync/cleanup')).send({ before: '2026-01-01T00:00:00.000Z' }).expect(200);
    await auth(request(app).post('/api/v2/sync/cleanup')).send().expect(200);
    await auth(request(app).get('/api/v2/hr/attendance?workDate=2026-08-04')).expect(200);
    await auth(request(app).get('/api/v2/hr/attendance')).expect(200);
    await auth(request(app).patch('/api/v2/system/business-alerts/missing/status')).send({ status: 'RESOLVED' }).expect(200);
    await auth(request(app).patch('/api/v2/system/business-alerts/missing/status')).send().expect(200);
    await auth(request(app).post('/api/v2/backups/cleanup')).send({ maxKeep: 10 }).expect(200);
    await auth(request(app).post('/api/v2/backups/cleanup')).send().expect(200);
    await auth(request(app).get('/api/v2/search?q=Demo')).expect(200);
    await auth(request(app).get('/api/v2/search')).expect(200);
  });
});
