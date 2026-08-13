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
import { registerFirstExamTrackingRoutes } from './first-exam-tracking-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('first exam tracking routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-first-exam-routes-'));
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
    registerFirstExamTrackingRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const now = '2026-08-05T10:00:00.000Z';
    for (const exam of [
      { id: 'route-ov-1', followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-05T09:00:00.000Z' },
      { id: 'route-ov-2', followUpStatus: 'LOST', nextFollowUpAt: null },
      { id: 'route-ov-3', followUpStatus: null, nextFollowUpAt: null },
      { id: 'route-patch-1', followUpStatus: 'PENDING', nextFollowUpAt: null },
    ]) {
      db.prepare(
        `INSERT INTO FirstExam (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, status, followUpStatus, nextFollowUpAt
         ) VALUES (?, ?, ?, ?, NULL, ?, 'DRAFT', ?, ?)`,
      ).run(exam.id, 'clinic-v2-001', now, now, 'patient-demo-001', exam.followUpStatus, exam.nextFollowUpAt);
    }
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('PATCH /api/v2/first-exams/:id/tracking updates the row and returns the payload', async () => {
    const res = await request(app)
      .patch('/api/v2/first-exams/route-patch-1/tracking')
      .send({ followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-12', trackingNote: '一周后回访' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-patch-1', followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-12' });

    const row = db.prepare('SELECT * FROM FirstExam WHERE id = ?').get('route-patch-1') as Record<string, unknown>;
    expect(row.followUpStatus).toBe('PENDING');
    expect(row.nextFollowUpAt).toBe('2026-08-12');
    expect(row.trackingNote).toBe('一周后回访');
  });

  it('GET /api/v2/first-exams/tracking-overview returns per-status counts and dueToday', async () => {
    const res = await request(app).get('/api/v2/first-exams/tracking-overview').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      NONE: 1,
      PENDING: 2,
      HORIZONTAL_SHOULD: 0,
      HORIZONTAL_DONE: 0,
      LOST: 1,
      total: 4,
      dueToday: 1,
    });
  });

  it('returns 404 for a missing first exam', async () => {
    const res = await request(app)
      .patch('/api/v2/first-exams/missing-exam/tracking')
      .send({ followUpStatus: 'NONE' })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('FirstExam not found');
  });

  it('returns 400 for a lost exam without a loss reason type', async () => {
    const res = await request(app)
      .patch('/api/v2/first-exams/route-patch-1/tracking')
      .send({ followUpStatus: 'LOST' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('流失原因类型不能为空');
  });

  it('tolerates a missing request body', async () => {
    const res = await request(app).patch('/api/v2/first-exams/missing/tracking');
    expect([200, 400, 404]).toContain(res.status);
  });
});
