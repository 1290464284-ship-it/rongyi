import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { registerFirstExamRestartRoutes } from './first-exam-restart-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('first exam restart routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-first-exam-restart-routes-'));
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
    registerFirstExamRestartRoutes(app, buildRouteDeps(db));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertExam(id: string): void {
    db.prepare(
      `INSERT INTO FirstExam (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, consultantId, chiefComplaint, presentIllness,
         status, remark, followUpStatus, dentition
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'COMPLETED', '初次检查', 'PENDING', 'DECIDUOUS')`,
    ).run(id, 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', 'user-admin-001', '牙痛', '右上后牙疼痛一周');
  }

  it('GET /api/v2/first-exams/history returns an empty array for a patient without exams', async () => {
    const res = await request(app).get('/api/v2/first-exams/history?patientId=patient-demo-001').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('POST /api/v2/first-exams/:id/restart copies the exam and links the previous record', async () => {
    insertExam('route-exam-1');
    const res = await request(app)
      .post('/api/v2/first-exams/route-exam-1/restart')
      .send({ dentition: 'PERMANENT' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.id).not.toBe('route-exam-1');
    expect(res.body.data.patientId).toBe('patient-demo-001');
    expect(res.body.data.chiefComplaint).toBe('牙痛');
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.followUpStatus).toBe('NONE');
    expect(res.body.data.remark).toBe('重启检查');
    expect(res.body.data.dentition).toBe('PERMANENT');
    expect(res.body.data.previousExamId).toBe('route-exam-1');
    expect(res.body.data.restartedAt).toBe(nowIso);

    const original = db.prepare('SELECT status, remark FROM FirstExam WHERE id = ?').get('route-exam-1') as { status: string; remark: string };
    expect(original.status).toBe('COMPLETED');
    expect(original.remark).toBe('初次检查');
  });

  it('POST /api/v2/first-exams/:id/dentition updates the dentition', async () => {
    insertExam('route-exam-1');
    const res = await request(app)
      .post('/api/v2/first-exams/route-exam-1/dentition')
      .send({ dentition: 'MIXED' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ examId: 'route-exam-1', dentition: 'MIXED' });

    const row = db.prepare('SELECT dentition FROM FirstExam WHERE id = ?').get('route-exam-1') as { dentition: string };
    expect(row.dentition).toBe('MIXED');
  });

  it('POST /api/v2/first-exams/:id/teeth/:toothId/chief-mark marks the tooth', async () => {
    insertExam('route-exam-1');
    db.prepare(
      `INSERT INTO FirstExamTooth (
         id, clinicId, createdAt, updatedAt, deletedAt,
         examId, toothNumber, toothStatus
       ) VALUES (?, ?, ?, ?, NULL, ?, 26, 'CARIES')`,
    ).run('route-tooth-1', 'clinic-v2-001', nowIso, nowIso, 'route-exam-1');

    const res = await request(app)
      .post('/api/v2/first-exams/route-exam-1/teeth/route-tooth-1/chief-mark')
      .send({ chiefMark: 'HORIZONTAL_DONE' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ toothId: 'route-tooth-1', chiefMark: 'HORIZONTAL_DONE' });

    const row = db.prepare('SELECT chiefMark FROM FirstExamTooth WHERE id = ?').get('route-tooth-1') as { chiefMark: string };
    expect(row.chiefMark).toBe('HORIZONTAL_DONE');
  });

  it('tolerates missing request bodies', async () => {
    for (const path of [
      '/api/v2/first-exams/route-exam-1/restart',
      '/api/v2/first-exams/route-exam-1/dentition',
      '/api/v2/first-exams/route-exam-1/teeth/route-tooth-1/chief-mark',
    ]) {
      const res = await request(app).post(path);
      expect([200, 400, 404]).toContain(res.status);
    }
    const history = await request(app).get('/api/v2/first-exams/history');
    expect([200, 400, 404]).toContain(history.status);
  });
});
