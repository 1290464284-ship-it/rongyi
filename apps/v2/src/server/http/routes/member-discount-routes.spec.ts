import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerMemberDiscountRoutes } from './member-discount-routes';

describe('member discount routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-member-discount-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    const now = '2026-08-05T10:00:00.000Z';
    const insertCard = (
      id: string,
      cardNo: string,
      overrides: {
        discountRate?: number | null;
        maxDiscountAmount?: number | null;
        roundingMode?: string | null;
        annualDiscountLimit?: number | null;
        specialDiscountsJson?: string | null;
        clinicId?: string;
      } = {},
    ): void => {
      db.prepare(
        `INSERT INTO MemberCard (
           id, patientId, cardNo, balance, totalRecharge, totalConsume,
           points, totalPoints, level, status,
           discountRate, maxDiscountAmount, roundingMode, annualDiscountLimit, specialDiscountsJson,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'NORMAL', 'ACTIVE',
           ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        'patient-demo-001',
        cardNo,
        overrides.discountRate ?? null,
        overrides.maxDiscountAmount ?? null,
        overrides.roundingMode ?? null,
        overrides.annualDiscountLimit ?? null,
        overrides.specialDiscountsJson ?? null,
        overrides.clinicId ?? 'clinic-v2-001',
        now,
        now,
      );
    };
    insertCard('route-card-plan', 'ROUTE-C001', {
      discountRate: 90,
      maxDiscountAmount: 50000,
      roundingMode: 'FLOOR',
      annualDiscountLimit: 100000,
      specialDiscountsJson: JSON.stringify([{ name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 }]),
    });
    insertCard('route-card-noplan', 'ROUTE-C002');
    insertCard('route-card-other', 'ROUTE-C003', { clinicId: 'clinic-other' });
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt, code, name, gender, active)
       VALUES (?, ?, ?, ?, NULL, 'P003', 'Route No Card Patient', 'UNKNOWN', 1)`,
    ).run('patient-route-nocard', 'clinic-v2-001', now, now);

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
    registerMemberDiscountRoutes(app, db);
    // 注意：errorMiddleware 声明 5 参（含 logger），router@2.2 按 fn.length === 4 判定错误中间件，
    // 因此这里必须用 4 参包装。
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('PUT /api/v2/member-cards/:id/discount-plan saves the plan and GET reads it back', async () => {
    const put = await request(app)
      .put('/api/v2/member-cards/route-card-plan/discount-plan')
      .send({
        discountRate: 85,
        maxDiscountAmount: 30000,
        roundingMode: 'ROUND',
        annualDiscountLimit: 500000,
        specialDiscountsJson: [{ name: '种植', category: 'IMPLANT', rate: 85 }],
      })
      .expect(200);
    expect(put.body.success).toBe(true);
    expect(put.body.data).toEqual({
      id: 'route-card-plan',
      cardNo: 'ROUTE-C001',
      discountRate: 85,
      maxDiscountAmount: 30000,
      roundingMode: 'ROUND',
      annualDiscountLimit: 500000,
      specialDiscountsJson: [{ name: '种植', category: 'IMPLANT', rate: 85 }],
    });

    const row = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('route-card-plan') as Record<string, unknown>;
    expect(row.discountRate).toBe(85);
    expect(row.roundingMode).toBe('ROUND');
    expect(row.specialDiscountsJson).toBe(JSON.stringify([{ name: '种植', category: 'IMPLANT', rate: 85 }]));

    const get = await request(app).get('/api/v2/member-cards/route-card-plan/discount-plan').expect(200);
    expect(get.body.success).toBe(true);
    expect(get.body.data).toEqual({
      id: 'route-card-plan',
      cardNo: 'ROUTE-C001',
      discountRate: 85,
      maxDiscountAmount: 30000,
      roundingMode: 'ROUND',
      annualDiscountLimit: 500000,
      specialDiscountsJson: [{ name: '种植', category: 'IMPLANT', rate: 85 }],
    });
  });

  it('POST /api/v2/member-cards/:id/quote returns the discounted total', async () => {
    const res = await request(app)
      .post('/api/v2/member-cards/route-card-plan/quote')
      .send({ baseTotal: 20000 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      cardId: 'route-card-plan',
      cardNo: 'ROUTE-C001',
      patientId: 'patient-demo-001',
      applied: true,
      baseTotal: 20000,
      discount: 3000,
      total: 17000,
      roundingMode: 'ROUND',
      annualUsage: 0,
      annualRemaining: 500000,
    });
  });

  it('POST /api/v2/member-cards/:id/quote returns NO_PLAN for a card without a plan', async () => {
    const res = await request(app)
      .post('/api/v2/member-cards/route-card-noplan/quote')
      .send({ baseTotal: 12345 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      cardId: 'route-card-noplan',
      cardNo: 'ROUTE-C002',
      applied: false,
      baseTotal: 12345,
      discount: 0,
      total: 12345,
      reason: 'NO_PLAN',
    });
  });

  it('POST /api/v2/member-cards/quote quotes through the patient active card', async () => {
    const res = await request(app)
      .post('/api/v2/member-cards/quote')
      .send({ patientId: 'patient-demo-001', baseTotal: 10000 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.cardId).toBe('route-card-plan');
    expect(res.body.data.total).toBe(8500);
  });

  it('POST /api/v2/member-cards/quote returns NO_ACTIVE_CARD for a patient without a card', async () => {
    const res = await request(app)
      .post('/api/v2/member-cards/quote')
      .send({ patientId: 'patient-route-nocard', baseTotal: 5000 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      cardId: null,
      applied: false,
      baseTotal: 5000,
      discount: 0,
      total: 5000,
      reason: 'NO_ACTIVE_CARD',
    });
  });

  it('returns 400 for invalid plan input', async () => {
    const res = await request(app)
      .put('/api/v2/member-cards/route-card-plan/discount-plan')
      .send({ discountRate: 101 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('折扣率必须为 0-100 的整数');
  });

  it('returns 400 for an invalid quote amount', async () => {
    const res = await request(app)
      .post('/api/v2/member-cards/route-card-plan/quote')
      .send({ baseTotal: -5 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('原价金额必须为不小于 0 的整数（分）');
  });

  it('returns 404 for a missing card', async () => {
    const res = await request(app)
      .get('/api/v2/member-cards/missing-card/discount-plan')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Member card not found');
  });

  it('scopes cards to the clinic', async () => {
    const res = await request(app)
      .get('/api/v2/member-cards/route-card-other/discount-plan')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
