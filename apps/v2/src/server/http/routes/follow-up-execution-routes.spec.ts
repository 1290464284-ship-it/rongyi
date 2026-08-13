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
import { registerFollowUpExecutionRoutes } from './follow-up-execution-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('follow-up execution routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-follow-up-execution-routes-'));
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
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerFollowUpExecutionRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const now = '2026-08-05T10:00:00.000Z';
    const insert = (id: string, executionStatus: string | null, patientRating: number | null): void => {
      db.prepare(
        `INSERT INTO FollowUp (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, planDate, status, executionStatus, patientRating
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'PENDING', ?, ?)`,
      ).run(id, 'clinic-v2-001', now, now, 'patient-demo-001', '2026-08-05', executionStatus, patientRating);
    };
    insert('route-fu-1', 'PENDING', null);
    insert('route-fu-2', 'DONE', null);
    insert('route-fu-3', 'PENDING', null);
    for (const [id, rating] of [['route-nps-9', 9], ['route-nps-10', 10], ['route-nps-7', 7], ['route-nps-5', 5], ['route-nps-3', 3]] as Array<[string, number]>) {
      insert(id, 'DONE', rating);
    }
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/v2/follow-ups/nps returns grouped NPS statistics', async () => {
    const res = await request(app).get('/api/v2/follow-ups/nps').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      total: 5,
      promoters: 2,
      passives: 1,
      detractors: 2,
      nps: 0,
      average: 6.8,
      breakdown: [
        { rating: 3, count: 1 },
        { rating: 5, count: 1 },
        { rating: 7, count: 1 },
        { rating: 9, count: 1 },
        { rating: 10, count: 1 },
      ],
    });
  });

  it('POST /api/v2/follow-ups/:id/execute records the execution and persists it', async () => {
    const res = await request(app)
      .post('/api/v2/follow-ups/route-fu-1/execute')
      .send({
        executionStatus: 'DONE',
        patientRating: 8,
        painLevel: 3,
        feedback: '电话回访顺利',
        contactedAt: '2026-08-05T09:30:00.000Z',
        nextPlanDate: '2026-09-05',
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: 'route-fu-1',
      executionStatus: 'DONE',
      patientRating: 8,
      painLevel: 3,
      nextPlanDate: '2026-09-05',
    });

    const row = db.prepare('SELECT * FROM FollowUp WHERE id = ?').get('route-fu-1') as Record<string, unknown>;
    expect(row.executionStatus).toBe('DONE');
    expect(row.patientRating).toBe(8);
    expect(row.painLevel).toBe(3);
    expect(row.feedback).toBe('电话回访顺利');
    expect(row.contactedAt).toBe('2026-08-05T09:30:00.000Z');
    expect(row.nextPlanDate).toBe('2026-09-05');
    expect(row.status).toBe('COMPLETED');
    expect(row.completedAt).toBe('2026-08-05T10:00:00.000Z');
  });

  it('returns 400 for an invalid rating', async () => {
    const res = await request(app)
      .post('/api/v2/follow-ups/route-fu-3/execute')
      .send({ executionStatus: 'DONE', patientRating: 11, contactedAt: '2026-08-05T09:30:00.000Z' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('评分必须在 0-10 之间');
  });

  it('returns 409 when the follow-up was already executed', async () => {
    const res = await request(app)
      .post('/api/v2/follow-ups/route-fu-2/execute')
      .send({ executionStatus: 'DONE', contactedAt: '2026-08-05T09:30:00.000Z' })
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('该随访已完成执行');
  });

  it('returns 404 for a missing follow-up', async () => {
    const res = await request(app)
      .post('/api/v2/follow-ups/missing-fu/execute')
      .send({ executionStatus: 'DONE', contactedAt: '2026-08-05T09:30:00.000Z' })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('FollowUp not found');
  });

  it('tolerates a missing request body', async () => {
    const res = await request(app).post('/api/v2/follow-ups/missing/execute');
    expect([200, 400, 404, 409]).toContain(res.status);
  });
});
