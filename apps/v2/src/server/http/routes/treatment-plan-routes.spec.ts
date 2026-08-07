import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { errorMiddleware } from '../middleware';
import { registerTreatmentPlanRoutes } from './treatment-plan-routes';

describe('treatment plan routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: ReturnType<typeof express>;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-treatment-plan-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    const now = '2026-08-05T10:00:00.000Z';
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId, doctorId, name, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', '正畸计划', 'APPROVED', 20000)`,
    ).run('plan-route-001', 'clinic-v2-001', now, now);

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
    registerTreatmentPlanRoutes(app, db);
    // errorMiddleware 声明 5 个参数，router@2 仅将 fn.length === 4 的中间件视为错误处理器，故用 4 参包装
    app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      errorMiddleware(error, req, res, next);
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('POST /api/v2/treatment-plans/:id/print returns the printable payload and increments printCount', async () => {
    const response = await request(app)
      .post('/api/v2/treatment-plans/plan-route-001/print')
      .send({})
      .expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.plan.printCount).toBe(1);
    expect(response.body.data.plan.patientName).toBe('Demo Patient');
    expect(response.body.data.plan.doctorName).toBe('System Administrator');
    const row = db.prepare('SELECT printCount, lastPrintedAt FROM TreatmentPlan WHERE id = ?').get('plan-route-001') as {
      printCount: number;
      lastPrintedAt: string;
    };
    expect(row.printCount).toBe(1);
    expect(row.lastPrintedAt).toBe('2026-08-05T10:00:00.000Z');
  });

  it('POST /api/v2/treatment-plans/:id/sign persists the signature and returns id/signedAt/signerName', async () => {
    const response = await request(app)
      .post('/api/v2/treatment-plans/plan-route-001/sign')
      .send({ signature: 'data:image/png;base64,ROUTE', signerName: '王医生', remark: '现场确认' })
      .expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      id: 'plan-route-001',
      signedAt: '2026-08-05T10:00:00.000Z',
      signerName: '王医生',
    });
    const row = db.prepare(
      'SELECT patientSignature, signerName, signedAt, signatureRemark FROM TreatmentPlan WHERE id = ?',
    ).get('plan-route-001') as { patientSignature: string; signerName: string; signedAt: string; signatureRemark: string };
    expect(row.patientSignature).toBe('data:image/png;base64,ROUTE');
    expect(row.signerName).toBe('王医生');
    expect(row.signedAt).toBe('2026-08-05T10:00:00.000Z');
    expect(row.signatureRemark).toBe('现场确认');
  });

  it('POST sign returns 400 when signerName is missing', async () => {
    const response = await request(app)
      .post('/api/v2/treatment-plans/plan-route-001/sign')
      .send({ signature: 'data:image/png;base64,X' })
      .expect(400);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toBe('签署人姓名不能为空');
  });

  it('POST sign returns 400 when signature is missing', async () => {
    const response = await request(app)
      .post('/api/v2/treatment-plans/plan-route-001/sign')
      .send({ signerName: '王医生' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toBe('签名不能为空');
  });

  it('POST print returns 404 for an unknown plan', async () => {
    const response = await request(app)
      .post('/api/v2/treatment-plans/plan-missing/print')
      .send({})
      .expect(404);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.message).toBe('TreatmentPlan not found');
  });

  it('POST sign returns 404 for an unknown plan', async () => {
    const response = await request(app)
      .post('/api/v2/treatment-plans/plan-missing/sign')
      .send({ signature: 'x', signerName: '王医生' })
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
