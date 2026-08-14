import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerProcessingFlowRoutes } from './processing-flow-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('processing flow routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-processing-flow-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    const insertOrder = (id: string, number: string): void => {
      db.prepare(
        `INSERT INTO ProcessingOrder (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, number, totalFee, status
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 100000, 'SENT')`,
      ).run(id, 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', number);
    };
    const insertDictStep = (id: string, name: string, sortOrder: number): void => {
      db.prepare(
        `INSERT INTO ProcessingFlowStep (
           id, clinicId, createdAt, updatedAt, deletedAt,
           name, sortOrder, active
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1)`,
      ).run(id, 'clinic-v2-001', nowIso, nowIso, name, sortOrder);
    };
    insertOrder('route-po-1', 'RPO-1');
    insertOrder('route-po-2', 'RPO-2');
    insertOrder('route-po-3', 'RPO-3');
    insertOrder('route-po-4', 'RPO-4');
    insertDictStep('route-step-model', '模型设计', 0);
    insertDictStep('route-step-tryon', '试戴', 1);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerProcessingFlowRoutes(app, buildRouteDeps(db));
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

  it('GET steps 返回按词典自动生成的步骤', async () => {
    const res = await request(app).get('/api/v2/processing-orders/route-po-1/steps').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ stepName: '模型设计', status: 'PENDING', sortOrder: 0 });
    expect(res.body.data[1]).toMatchObject({ stepName: '试戴', status: 'PENDING' });
  });

  it('POST register-step 推进第一步为 DONE', async () => {
    const res = await request(app).post('/api/v2/processing-orders/route-po-2/register-step').send({}).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      stepId: 'route-step-model',
      status: 'DONE',
      completedAt: nowIso,
      operatorId: 'user-admin-001',
    });
    expect(res.body.data[1].status).toBe('PENDING');
  });

  it('POST register-step 将空串 stepId 归一化为未指定并推进默认第一步', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-2/register-step')
      .send({ stepId: '' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      stepId: 'route-step-model',
      status: 'DONE',
    });
  });

  it('POST set-step 手动修改状态（双击手动改）', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-3/set-step')
      .send({ stepId: 'route-step-model', status: 'IN_PROGRESS', remark: '双改' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      stepId: 'route-step-model',
      status: 'IN_PROGRESS',
      startedAt: nowIso,
      remark: '双改',
    });
  });

  it('GET stats 按日期筛选返回流程统计', async () => {
    await request(app).post('/api/v2/processing-orders/route-po-4/register-step').send({}).expect(200);
    await request(app)
      .post('/api/v2/processing-orders/route-po-4/set-step')
      .send({ stepId: 'route-step-tryon', status: 'IN_PROGRESS' })
      .expect(200);
    await request(app)
      .post('/api/v2/processing-orders/route-po-3/set-step')
      .send({ stepId: 'route-step-model', status: 'IN_PROGRESS' })
      .expect(200);
    const res = await request(app).get('/api/v2/processing-flow-stats?from=2026-08-05&to=2026-08-05').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.from).toBe('2026-08-05');
    expect(res.body.data.to).toBe('2026-08-05');
    expect(res.body.data.steps.map((step: { stepName: string }) => step.stepName)).toEqual(['模型设计', '试戴']);
    const model = res.body.data.steps.find((step: { stepId: string }) => step.stepId === 'route-step-model');
    expect(model.doneCount).toBeGreaterThanOrEqual(1);
    expect(model.inProgressCount).toBeGreaterThanOrEqual(1);
  });

  it('GET steps 对不存在的加工单返回 404', async () => {
    const res = await request(app).get('/api/v2/processing-orders/route-po-missing/steps').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST register-step and set-step tolerate non-string body fields', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-1/register-step')
      .send({ stepId: 123 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].status).toBe('DONE');

    const setRes = await request(app)
      .post('/api/v2/processing-orders/route-po-1/set-step')
      .send({ stepId: { nested: true }, status: 'IN_PROGRESS' })
      .expect(404);
    expect(setRes.body.success).toBe(false);
  });

  it('GET stats tolerates empty date filters', async () => {
    const res = await request(app).get('/api/v2/processing-flow-stats').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.from).toBeNull();
    expect(res.body.data.to).toBeNull();
  });

  it('tolerates missing request bodies', async () => {
    const register = await request(app).post('/api/v2/processing-orders/missing/register-step');
    expect([200, 400, 404, 409]).toContain(register.status);
    const setStep = await request(app).post('/api/v2/processing-orders/missing/set-step');
    expect([200, 400, 404, 409]).toContain(setStep.status);
  });
});
