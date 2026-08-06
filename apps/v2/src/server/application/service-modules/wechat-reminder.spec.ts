import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { WechatReminderService } from './wechat-reminder';

describe('WechatReminderService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-wechat-reminder-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
    // 种子演示预约使用真实当前时间，可能与固定测试日期重叠；移到遥远的未来。
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertAppointment(id: string, startTime: string, status = 'BOOKED'): void {
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'REGULAR')`,
    ).run(id, context.clinicId, now, now, 'patient-demo-001', 'user-admin-001', startTime, startTime, status);
  }

  function insertVisit(id: string, completedAt: string, status = 'COMPLETED'): void {
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(id, context.clinicId, now, now, 'patient-demo-001', 'user-admin-001', completedAt, completedAt, status);
  }

  function insertFirstExam(id: string, createdAt: string, followUpStatus: string | null = null): void {
    db.prepare(
      `INSERT INTO FirstExam (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, status, followUpStatus
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'NEW', ?)`,
    ).run(id, context.clinicId, createdAt, createdAt, 'patient-demo-001', 'user-admin-001', followUpStatus);
  }

  function pendingCount(): number {
    return (db.prepare(
      `SELECT COUNT(*) AS c FROM WechatReminder WHERE clinicId = ? AND status = 'PENDING'`,
    ).get(context.clinicId) as { c: number }).c;
  }

  it('generates an appointment reminder for tomorrow bookings', () => {
    insertAppointment('appt-rem-1', '2026-08-06T09:00:00.000Z');
    const service = new WechatReminderService(db);
    const result = service.today(context);

    expect(result.date).toBe('2026-08-05');
    expect(result.config.enabled).toBe(true);
    const item = result.items.find((row) => row.scene === 'APPOINTMENT_REMINDER');
    expect(item).toBeDefined();
    expect(item?.patientName).toBe('Demo Patient');
    expect(item?.patientPhone).toBe('13800000000');
    expect(item?.sceneLabel).toBe('复诊提醒');
    expect(item?.content).toContain('Demo Patient');
    expect(item?.content).toContain('复诊');

    const row = db.prepare('SELECT * FROM WechatReminder WHERE id = ?').get(item!.id) as Record<string, unknown>;
    expect(row.status).toBe('PENDING');
    expect(row.scheduledDate).toBe('2026-08-05');
    expect(row.sourceId).toBe('appt-rem-1');
  });

  it('generates treatment recall for visits completed N days ago', () => {
    insertVisit('visit-rem-1', '2026-08-02T08:00:00.000Z');
    const service = new WechatReminderService(db);
    const result = service.today(context);

    const item = result.items.find((row) => row.scene === 'TREATMENT_RECALL');
    expect(item).toBeDefined();
    expect(item?.content).toContain('3 天');
  });

  it('generates first-exam nudges and skips lost patients', () => {
    insertFirstExam('exam-rem-1', '2026-08-02T02:00:00.000Z', null);
    insertFirstExam('exam-rem-lost', '2026-08-02T02:00:00.000Z', 'LOST');
    const service = new WechatReminderService(db);
    const result = service.today(context);

    const nudges = result.items.filter((row) => row.scene === 'FIRST_EXAM_NUDGE');
    expect(nudges).toHaveLength(1);
    expect(nudges[0].sourceId).toBe('exam-rem-1');
  });

  it('is idempotent across repeated calls', () => {
    const service = new WechatReminderService(db);
    const before = pendingCount();
    const result = service.today(context);
    expect(pendingCount()).toBe(before);
    expect(result.items).toHaveLength(before);
  });

  it('skips cancelled appointments and in-progress visits', () => {
    insertAppointment('appt-rem-cancelled', '2026-08-06T14:00:00.000Z', 'CANCELLED');
    insertVisit('visit-rem-ongoing', '2026-08-02T08:00:00.000Z', 'IN_PROGRESS');
    const service = new WechatReminderService(db);
    service.today(context);
    const sources = (db.prepare('SELECT sourceId FROM WechatReminder WHERE clinicId = ?').all(context.clinicId) as Array<{ sourceId: string }>)
      .map((row) => row.sourceId);
    expect(sources).not.toContain('appt-rem-cancelled');
    expect(sources).not.toContain('visit-rem-ongoing');
  });

  it('marks a reminder as sent and writes a WechatMessage history record', () => {
    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.scene === 'APPOINTMENT_REMINDER');
    expect(item).toBeDefined();

    const result = service.markSent(item!.id, context);
    expect(result.status).toBe('SENT');
    expect(result.messageId).toBeDefined();

    const row = db.prepare('SELECT * FROM WechatReminder WHERE id = ?').get(item!.id) as Record<string, unknown>;
    expect(row.status).toBe('SENT');
    expect(row.sentBy).toBe('user-admin-001');
    expect(row.sentAt).toBe(now);

    const message = db.prepare('SELECT * FROM WechatMessage WHERE id = ?').get(result.messageId as string) as Record<string, unknown>;
    expect(message.patientId).toBe('patient-demo-001');
    expect(message.type).toBe('APPOINTMENT_REMINDER');
    expect(message.status).toBe('SENT');
    expect(message.content).toBe(item!.content);
  });

  it('rejects marking a non-pending reminder as sent', () => {
    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.scene === 'TREATMENT_RECALL');
    expect(item).toBeDefined();
    service.markSent(item!.id, context);
    expect(() => service.markSent(item!.id, context)).toThrow(ConflictError);
  });

  it('dismisses a reminder and rejects repeated dismissal', () => {
    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.scene === 'FIRST_EXAM_NUDGE');
    expect(item).toBeDefined();

    const dismissed = service.dismiss(item!.id, context);
    expect(dismissed.status).toBe('DISMISSED');
    const row = db.prepare('SELECT status FROM WechatReminder WHERE id = ?').get(item!.id) as { status: string };
    expect(row.status).toBe('DISMISSED');
    expect(() => service.dismiss(item!.id, context)).toThrow(ConflictError);
  });

  it('throws NotFound for unknown reminder ids', () => {
    const service = new WechatReminderService(db);
    expect(() => service.markSent('missing-id', context)).toThrow(NotFoundError);
    expect(() => service.dismiss('missing-id', context)).toThrow(NotFoundError);
  });

  it('honors overridden days and content from settings', () => {
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).run('setting-recall-2', context.clinicId, now, now, 'wechatReminder.recallDaysAfter', '2');
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).run('setting-recall-content', context.clinicId, now, now, 'wechatReminder.recallContent', '{patientName}，恢复如何？');
    insertVisit('visit-rem-2d', '2026-08-03T08:00:00.000Z');

    const service = new WechatReminderService(db);
    const result = service.today(context);
    expect(result.config.recallDaysAfter).toBe(2);
    const item = result.items.find((row) => row.sourceId === 'visit-rem-2d');
    expect(item).toBeDefined();
    expect(item?.content).toBe('Demo Patient，恢复如何？');
  });

  it('stops generating when disabled', () => {
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, 'wechatReminder.enabled', 'false')`,
    ).run('setting-disabled', context.clinicId, now, now);
    insertAppointment('appt-rem-disabled', '2026-08-06T10:00:00.000Z');

    const service = new WechatReminderService(db);
    const result = service.today(context);
    expect(result.config.enabled).toBe(false);
    expect(result.items.some((row) => row.sourceId === 'appt-rem-disabled')).toBe(false);
    const row = db.prepare('SELECT 1 FROM WechatReminder WHERE sourceId = ?').get('appt-rem-disabled');
    expect(row).toBeUndefined();
  });
});
