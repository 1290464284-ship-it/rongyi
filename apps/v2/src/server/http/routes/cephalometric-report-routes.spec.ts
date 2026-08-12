import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerCephalometricReportRoutes } from './cephalometric-report-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('cephalometric report routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cephalometric-report-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { context: unknown }).context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerCephalometricReportRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const insertCase = (id: string, landmarksJson: string, metricsJson: string): void => {
      db.prepare(
        `INSERT INTO CephalometricCase (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, imageUrl, landmarksJson, metricsJson, status, remark
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'DRAFT', NULL)`,
      ).run(id, 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', `https://img.example.com/${id}.png`, landmarksJson, metricsJson);
    };
    insertCase('route-case-1', JSON.stringify({ sella: [10, 20] }), JSON.stringify({ snLength: 70 }));
    insertCase('route-case-2', JSON.stringify({ sella: [12, 21] }), JSON.stringify({ snLength: 72 }));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('POST /api/v2/cephalometric/:id/report saves the report', async () => {
    const res = await request(app)
      .post('/api/v2/cephalometric/route-case-1/report')
      .send({ reportJson: { conclusion: '正常', snLength: 70.5 }, reportStatus: 'COMPLETED' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ caseId: 'route-case-1', reportStatus: 'COMPLETED' });
    const row = db.prepare('SELECT reportJson, reportStatus FROM CephalometricCase WHERE id = ?').get('route-case-1') as { reportJson: string; reportStatus: string };
    expect(row.reportStatus).toBe('COMPLETED');
    expect(JSON.parse(row.reportJson)).toEqual({ conclusion: '正常', snLength: 70.5 });
  });

  it('GET /api/v2/cephalometric/:id/report returns the parsed report', async () => {
    const res = await request(app).get('/api/v2/cephalometric/route-case-2/report').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      caseId: 'route-case-2',
      patientId: 'patient-demo-001',
      reportJson: {},
      metricsJson: { snLength: 72 },
      landmarksJson: { sella: [12, 21] },
    });
  });

  it('POST /api/v2/cephalometric/:id/send writes a WechatMessage', async () => {
    const res = await request(app)
      .post('/api/v2/cephalometric/route-case-1/send')
      .send({ note: '您的测量报告已完成', phone: '13800000000' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      patientId: 'patient-demo-001',
      type: 'CEPHALOMETRIC_REPORT',
      status: 'SENT',
      sentAt: nowIso,
    });
    const message = db.prepare('SELECT content, remark FROM WechatMessage WHERE id = ?').get(res.body.data.messageId) as { content: string; remark: string };
    expect(message.content).toBe('您的测量报告已完成');
    expect(message.remark).toBe('phone:13800000000');
  });

  it('replays the same send request id without creating another message', async () => {
    const first = await request(app)
      .post('/api/v2/cephalometric/route-case-1/send')
      .set('Idempotency-Key', 'ceph-send-replay')
      .send({ note: 'replay' })
      .expect(200);
    const second = await request(app)
      .post('/api/v2/cephalometric/route-case-1/send')
      .set('Idempotency-Key', 'ceph-send-replay')
      .send({ note: 'replay' })
      .expect(200);
    expect(second.body.data.messageId).toBe(first.body.data.messageId);
    const count = db.prepare('SELECT COUNT(*) AS c FROM WechatMessage WHERE id = ?').get(first.body.data.messageId) as { c: number };
    expect(Number(count.c)).toBe(1);
  });

  it('POST /api/v2/cephalometric/compare returns overlapping cases', async () => {
    const res = await request(app)
      .post('/api/v2/cephalometric/compare')
      .send({ caseIds: ['route-case-1', 'route-case-2'] })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cases).toHaveLength(2);
    expect(res.body.data.cases.map((row: { id: string }) => row.id)).toEqual(['route-case-1', 'route-case-2']);
    expect(res.body.data.cases[0].landmarksJson).toEqual({ sella: [10, 20] });
  });

  it('GET /api/v2/cephalometric/:id/report returns 404 for a missing case', async () => {
    const res = await request(app).get('/api/v2/cephalometric/route-missing/report').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Cephalometric case not found');
  });

  it('POST /api/v2/cephalometric/compare rejects invalid payloads', async () => {
    const res = await request(app)
      .post('/api/v2/cephalometric/compare')
      .send({ caseIds: [] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('请选择 1-10 个测量病例进行比较');
  });
});
