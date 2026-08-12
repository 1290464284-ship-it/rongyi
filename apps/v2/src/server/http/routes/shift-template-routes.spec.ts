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
import { registerShiftTemplateRoutes } from './shift-template-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('shift template routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-06T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-shift-template-routes-'));
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
        now: () => new Date(now),
      };
      next();
    });
    registerShiftTemplateRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const insertUser = (id: string, username: string, name: string, role: string): void => {
      db.prepare(
        `INSERT INTO User (
           id, clinicId, createdAt, updatedAt, deletedAt,
           username, passwordHash, name, role, active, loginAttempts, tokenVersion
         ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, 'x', ?, ?, 1, 0, 0)`,
      ).run(id, now, now, username, name, role);
    };
    insertUser('user-doctor-001', 'doctor01', '张医生', 'DOCTOR');
    insertUser('user-nurse-001', 'nurse01', '李医生', 'DOCTOR');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('POST /api/v2/shift-templates creates a template with parsed work days', async () => {
    const res = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '早班', startTime: '09:00', endTime: '18:00', workDaysJson: [1, 2, 3, 4, 5], color: '#4F46E5', active: true })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: '早班',
      startTime: '09:00',
      endTime: '18:00',
      color: '#4F46E5',
      active: 1,
      workDays: [1, 2, 3, 4, 5],
    });
  });

  it('GET /api/v2/shift-templates lists templates and resolves workDaysJson', async () => {
    const res = await request(app).get('/api/v2/shift-templates').expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    const morning = data.find((template) => template.name === '早班');
    expect(morning).toBeDefined();
    expect(morning?.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(morning?.startTime).toBe('09:00');
  });

  it('PATCH /api/v2/shift-templates/:id renames, changes days and toggles active', async () => {
    const created = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '晚班', startTime: '13:00', endTime: '22:00', workDaysJson: [6, 7], color: '#F59E0B' })
      .expect(201);
    const id = String(created.body.data.id);

    const updated = await request(app)
      .patch(`/api/v2/shift-templates/${id}`)
      .send({ name: '周末晚班', workDaysJson: [6, 7], active: false })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: '周末晚班', active: 0, workDays: [6, 7] });

    const list = await request(app).get('/api/v2/shift-templates?activeOnly=1').expect(200);
    const ids = (list.body.data as Array<Record<string, unknown>>).map((row) => row.id);
    expect(ids).not.toContain(id);
  });

  it('PATCH rejects a soft-deleted shift template', async () => {
    const created = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '待删除班次', startTime: '08:00', endTime: '12:00' })
      .expect(201);
    const id = String(created.body.data.id);
    db.prepare('UPDATE ShiftTemplate SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(now, now, id);
    await request(app)
      .patch(`/api/v2/shift-templates/${id}`)
      .send({ name: '不应生效' })
      .expect(404);
  });

  it('POST /api/v2/shift-templates/generate creates one FIXED schedule per work day of the week', async () => {
    const template = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '早班', startTime: '09:00', endTime: '18:00', workDaysJson: [1, 2, 3, 4, 5], color: '#4F46E5' })
      .expect(201);
    const templateId = String(template.body.data.id);

    const res = await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-doctor-001', weekStart: '2026-08-05' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ created: 5, skipped: 0, weekStart: '2026-08-03' });

    const rows = db.prepare(
      'SELECT * FROM WorkSchedule WHERE shiftTemplateId = ? AND deletedAt IS NULL ORDER BY startTime ASC',
    ).all(templateId) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      userId: 'user-doctor-001',
      type: 'FIXED',
      isRecurring: 1,
      weekDay: 1,
      title: '早班',
      color: '#4F46E5',
      startTime: '2026-08-03T09:00:00',
      endTime: '2026-08-03T18:00:00',
    });
    expect(rows[4]).toMatchObject({ weekDay: 5, startTime: '2026-08-07T09:00:00', endTime: '2026-08-07T18:00:00' });
  });

  it('generate is idempotent: same user/template/week skips existing days and reports counts', async () => {
    const template = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '早班', startTime: '09:00', endTime: '18:00', workDaysJson: [1, 2, 3, 4, 5] })
      .expect(201);
    const templateId = String(template.body.data.id);

    await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-nurse-001', weekStart: '2026-08-03' })
      .expect(200);
    const second = await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-nurse-001', weekStart: '2026-08-03' })
      .expect(200);
    expect(second.body.data).toEqual({ created: 0, skipped: 5, weekStart: '2026-08-03' });
  });

  it('GET /api/v2/schedules/week returns the week view joined with user names', async () => {
    const template = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '周视早班', startTime: '09:00', endTime: '18:00', workDaysJson: [1, 2, 3, 4, 5] })
      .expect(201);
    const templateId = String(template.body.data.id);
    await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-doctor-001', weekStart: '2026-08-03' })
      .expect(200);

    const res = await request(app).get('/api/v2/schedules/week?weekStart=2026-08-03').expect(200);
    expect(res.body.success).toBe(true);
    const allRows = res.body.data as Array<Record<string, unknown>>;
    const rows = allRows.filter((row) => row.userId === 'user-doctor-001' && row.title === '周视早班');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      userId: 'user-doctor-001',
      userIdLabel: '张医生',
      title: '周视早班',
      type: 'FIXED',
      weekDay: 1,
      date: '2026-08-03',
      startTime: '2026-08-03T09:00:00',
    });
    expect(rows.map((row) => row.date)).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
    ]);
    expect(rows.map((row) => row.weekDay)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects invalid time format and empty work days with 400', async () => {
    const invalidTime = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '坏时间', startTime: '25:00', endTime: '18:00' })
      .expect(400);
    expect(invalidTime.body.code).toBe('VALIDATION_ERROR');

    const emptyDays = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '空工作日', startTime: '09:00', endTime: '18:00', workDaysJson: [] })
      .expect(400);
    expect(emptyDays.body.code).toBe('VALIDATION_ERROR');

    const endBeforeStart = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '反向时间', startTime: '18:00', endTime: '09:00' })
      .expect(400);
    expect(endBeforeStart.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects generate for missing template, missing user, and inactive template', async () => {
    const missingTemplate = await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId: 'template-missing', userId: 'user-doctor-001', weekStart: '2026-08-03' })
      .expect(404);
    expect(missingTemplate.body.code).toBe('NOT_FOUND');

    const created = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '临时模板', startTime: '09:00', endTime: '18:00' })
      .expect(201);
    const templateId = String(created.body.data.id);

    const missingUser = await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-missing', weekStart: '2026-08-03' })
      .expect(404);
    expect(missingUser.body.code).toBe('NOT_FOUND');

    await request(app).patch(`/api/v2/shift-templates/${templateId}`).send({ active: false }).expect(200);
    const inactive = await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-doctor-001', weekStart: '2026-08-03' })
      .expect(409);
    expect(inactive.body.code).toBe('CONFLICT');
  });

  it('parses string booleans strictly for active and rejects impossible weekStart dates', async () => {
    const created = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '晚班', startTime: '14:00', endTime: '22:00', active: 'false' })
      .expect(201);
    const templateId = created.body.data.id as string;
    expect((db.prepare('SELECT active FROM ShiftTemplate WHERE id = ?').get(templateId) as { active: number }).active).toBe(0);
    await request(app).patch(`/api/v2/shift-templates/${templateId}`).send({ active: true }).expect(200);
    await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: '非法布尔', startTime: '09:00', endTime: '10:00', active: 'yes' })
      .expect(400);
    await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId, userId: 'user-doctor-001', weekStart: '2026-02-30' })
      .expect(400);
  });

  it('rejects malformed work day JSON and non-date weekStart values', async () => {
    await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: 'Bad JSON', startTime: '09:00', endTime: '18:00', workDaysJson: 'not-json' })
      .expect(400);
    await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: 'Bad Shape', startTime: '09:00', endTime: '18:00', workDaysJson: {} })
      .expect(400);

    const created = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: 'Week Start', startTime: '09:00', endTime: '18:00', workDaysJson: [1, 2, 3, 4, 5] })
      .expect(201);
    await request(app)
      .post('/api/v2/shift-templates/generate')
      .send({ templateId: String(created.body.data.id), userId: 'user-doctor-001', weekStart: 'garbage' })
      .expect(400);
  });

  it('lists templates with non-array workDaysJson as empty work days', async () => {
    const created = await request(app)
      .post('/api/v2/shift-templates')
      .send({ name: 'Object Days', startTime: '09:00', endTime: '18:00', workDaysJson: [1, 2, 3, 4, 5] })
      .expect(201);
    const id = String(created.body.data.id);
    db.prepare('UPDATE ShiftTemplate SET workDaysJson = ? WHERE id = ?').run('{}', id);
    const list = await request(app).get('/api/v2/shift-templates').expect(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find((entry) => entry.id === id);
    expect(row?.workDays).toEqual([]);
  });
});
