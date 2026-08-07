import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { registerMedicalRecordEditRoutes } from './medical-record-edit-routes';
import { errorMiddleware } from '../middleware';
import { buildRouteDeps } from './route-deps.helper';

describe('medical record edit routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-03T00:00:00.000Z';

  function insertRecord(
    id: string,
    overrides: Record<string, unknown> = {},
  ): void {
    const defaults: Record<string, unknown> = {
      id,
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'DRAFT',
      category: 'GENERAL',
      diagnosis: '原诊断',
      teethInvolved: '["11"]',
      images: '[]',
      isLocked: 1,
      lockedAt: '2026-08-01T00:00:00.000Z',
      lockedBy: 'user-admin-001',
    };
    const row = { ...defaults, ...overrides };
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO MedicalRecord (${columns.join(', ')}) VALUES (${placeholders})`)
      .run(...columns.map((column) => row[column]));
  }

  function getRecord(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM MedicalRecord WHERE id = ?').get(id) as Record<string, unknown>;
  }

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-medical-record-edit-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { context: unknown }).context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date('2026-08-03T08:00:00.000Z'),
      };
      next();
    });
    registerMedicalRecordEditRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      errorMiddleware(error, req, res, next);
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates an edit request with 201 and persists PENDING', async () => {
    insertRecord('r-route-1');

    const response = await request(app)
      .post('/api/v2/medical-records/r-route-1/edit-request')
      .send({ reason: '修正诊断', proposedContent: { diagnosis: '新诊断' } })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ id: 'r-route-1', editRequestStatus: 'PENDING' });
    const row = getRecord('r-route-1');
    expect(row.editRequestStatus).toBe('PENDING');
    expect(row.editRequestReason).toBe('修正诊断');
    expect(row.editRequestedById).toBe('user-admin-001');
    expect(JSON.parse(String(row.proposedContentJson))).toEqual({ diagnosis: '新诊断' });
  });

  it('reviews with approve and merges content, unlocking the record', async () => {
    insertRecord('r-route-2');

    await request(app)
      .post('/api/v2/medical-records/r-route-2/edit-request')
      .send({ reason: '更新内容', proposedContent: { diagnosis: '合并后诊断', teethInvolved: ['12'] } })
      .expect(201);

    const response = await request(app)
      .patch('/api/v2/medical-records/r-route-2/edit-request/review')
      .send({ approve: true, reviewNote: '同意' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ id: 'r-route-2', editRequestStatus: 'APPROVED', applied: true });
    const row = getRecord('r-route-2');
    expect(row.diagnosis).toBe('合并后诊断');
    expect(JSON.parse(String(row.teethInvolved))).toEqual(['12']);
    expect(row.isLocked).toBe(0);
    expect(row.lockedAt).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.reviewedById).toBe('user-admin-001');
    expect(row.reviewNote).toBe('同意');
  });

  it('rejects with approve=false and keeps the record locked', async () => {
    insertRecord('r-route-3');

    await request(app)
      .post('/api/v2/medical-records/r-route-3/edit-request')
      .send({ reason: '申请修改', proposedContent: { diagnosis: '不应合并' } })
      .expect(201);

    const response = await request(app)
      .patch('/api/v2/medical-records/r-route-3/edit-request/review')
      .send({ approve: false, reviewNote: '不通过' })
      .expect(200);

    expect(response.body.data).toEqual({ id: 'r-route-3', editRequestStatus: 'REJECTED', applied: false });
    const row = getRecord('r-route-3');
    expect(row.diagnosis).toBe('原诊断');
    expect(row.isLocked).toBe(1);
    expect(row.editRequestStatus).toBe('REJECTED');
    expect(row.reviewNote).toBe('不通过');
  });

  it('returns 404 for an unknown record', async () => {
    const response = await request(app)
      .post('/api/v2/medical-records/missing-record/edit-request')
      .send({ reason: '原因', proposedContent: { diagnosis: 'X' } })
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.message).toBe('MedicalRecord not found');
  });

  it('returns 409 when a request already exists', async () => {
    insertRecord('r-route-4');

    await request(app)
      .post('/api/v2/medical-records/r-route-4/edit-request')
      .send({ reason: '第一次', proposedContent: { diagnosis: 'X' } })
      .expect(201);

    const response = await request(app)
      .post('/api/v2/medical-records/r-route-4/edit-request')
      .send({ reason: '第二次', proposedContent: { diagnosis: 'Y' } })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(response.body.message).toBe('该病历已有待审核的修改申请');
  });

  it('returns 409 when reviewing a record without a pending request', async () => {
    insertRecord('r-route-5');

    const response = await request(app)
      .patch('/api/v2/medical-records/r-route-5/edit-request/review')
      .send({ approve: true })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(response.body.message).toBe('该病历没有待审核的修改申请');
  });

  it('returns 400 for an empty reason', async () => {
    insertRecord('r-route-6');

    const response = await request(app)
      .post('/api/v2/medical-records/r-route-6/edit-request')
      .send({ reason: '', proposedContent: { diagnosis: 'X' } })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toBe('修改原因不能为空');
  });
});
