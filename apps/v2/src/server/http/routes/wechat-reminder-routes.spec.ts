import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { registerWechatReminderRoutes } from './wechat-reminder-routes';
import { buildRouteDeps } from './route-deps.helper';
import { WechatReminderService } from '../../application/service-modules/wechat-reminder';

describe('wechat reminder routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  let service: WechatReminderService;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-wechat-reminder-routes-'));
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
    service = new WechatReminderService(db);
    registerWechatReminderRoutes(app, buildRouteDeps(db), service);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = error instanceof Error && 'status' in error ? Number((error as { status?: number }).status) : 500;
      res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        code: 'ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  beforeEach(() => {
    // B-L8：清除今日生成缓存，保证每个用例插入的数据都会重新扫描生成。
    service.clearTodayGeneratedCache();
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns the config', async () => {
    const res = await request(app).get('/api/v2/wechat-reminders/config').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.appointmentDaysBefore).toBe(1);
    expect(res.body.data.recallDaysAfter).toBe(3);
    expect(res.body.data.firstExamDaysAfter).toBe(3);
    expect(res.body.data.enabled).toBe(true);
  });

  it('updates reminder timing settings', async () => {
    const res = await request(app)
      .patch('/api/v2/wechat-reminders/config')
      .send({ appointmentDaysBefore: 2, recallDaysAfter: 5, firstExamDaysAfter: 7 })
      .expect(200);
    expect(res.body.data.appointmentDaysBefore).toBe(2);
    expect(res.body.data.recallDaysAfter).toBe(5);
    expect(res.body.data.firstExamDaysAfter).toBe(7);
    const config = await request(app).get('/api/v2/wechat-reminders/config').expect(200);
    expect(config.body.data.recallDaysAfter).toBe(5);
    await request(app)
      .patch('/api/v2/wechat-reminders/config')
      .send({ appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 })
      .expect(200);
  });

  it('rejects invalid reminder timing settings', async () => {
    const res = await request(app)
      .patch('/api/v2/wechat-reminders/config')
      .send({ appointmentDaysBefore: 999 })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('returns an empty today list when nothing is due', async () => {
    const res = await request(app).get('/api/v2/wechat-reminders/today').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.date).toBe('2026-08-05');
    expect(res.body.data.items).toEqual([]);
  });

  it('generates and lists an appointment reminder', async () => {
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('route-appt-rem', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-06T09:00:00.000Z', '2026-08-06T10:00:00.000Z');

    const res = await request(app).get('/api/v2/wechat-reminders/today').expect(200);
    expect(res.body.data.items).toHaveLength(1);
    const item = res.body.data.items[0];
    expect(item.scene).toBe('APPOINTMENT_REMINDER');
    expect(item.patientName).toBe('Demo Patient');
    expect(item.content).toContain('Demo Patient');
  });

  it('marks a reminder as sent and writes a WechatMessage', async () => {
    const list = await request(app).get('/api/v2/wechat-reminders/today').expect(200);
    const item = list.body.data.items[0];
    const res = await request(app).post(`/api/v2/wechat-reminders/${item.id}/mark-sent`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('SENT');
    expect(res.body.data.messageId).toBeDefined();
    const message = db.prepare('SELECT status, type FROM WechatMessage WHERE id = ?').get(res.body.data.messageId) as { status: string; type: string };
    expect(message.status).toBe('SENT');
    expect(message.type).toBe('APPOINTMENT_REMINDER');
  });

  it('dismisses a reminder', async () => {
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('route-appt-rem-2', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-06T11:00:00.000Z', '2026-08-06T12:00:00.000Z');
    const list = await request(app).get('/api/v2/wechat-reminders/today').expect(200);
    const pending = list.body.data.items.find((row: { scene: string }) => row.scene === 'APPOINTMENT_REMINDER') as { id: string } | undefined;
    expect(pending).toBeDefined();
    const res = await request(app).post(`/api/v2/wechat-reminders/${pending!.id}/dismiss`).expect(200);
    expect(res.body.data.status).toBe('DISMISSED');
    const row = db.prepare('SELECT status FROM WechatReminder WHERE id = ?').get(pending!.id) as { status: string };
    expect(row.status).toBe('DISMISSED');
  });
});
