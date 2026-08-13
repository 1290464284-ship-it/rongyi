import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  beforeEach(() => {
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

  afterEach(() => {
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
    expect(item?.patientPhone).toBe('138****0000'); // 电话直出已掩码
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
    insertAppointment('appt-rem-1', '2026-08-06T09:00:00.000Z');
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
    insertVisit('visit-rem-1', '2026-08-02T08:00:00.000Z');
    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.scene === 'TREATMENT_RECALL');
    expect(item).toBeDefined();
    service.markSent(item!.id, context);
    expect(() => service.markSent(item!.id, context)).toThrow(ConflictError);
  });

  it('dismisses a reminder and rejects repeated dismissal', () => {
    insertFirstExam('exam-rem-1', '2026-08-02T02:00:00.000Z', null);
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

  it('does not let another clinic mark or dismiss a reminder', () => {
    insertAppointment('appt-rem-cross-clinic', '2026-08-06T12:00:00.000Z');
    // 新实例不共享 5 分钟生成缓存，保证今天列表里存在刚生成的 PENDING 提醒。
    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.sourceId === 'appt-rem-cross-clinic');
    expect(item).toBeDefined();
    const otherContext: AppContext = {
      userId: 'user-other',
      clinicId: 'clinic-other',
      role: 'BOSS',
      traceId: 'trace-other',
      now: () => new Date(now),
    };
    expect(() => service.markSent(item!.id, otherContext)).toThrow(NotFoundError);
    expect(() => service.dismiss(item!.id, otherContext)).toThrow(NotFoundError);
    const row = db.prepare('SELECT status FROM WechatReminder WHERE id = ?').get(item!.id) as { status: string };
    expect(row.status).toBe('PENDING');
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

  it('treats dollar replacement patterns in patient names literally', () => {
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DOLLAR', '$&', 'UNKNOWN', '13700000009',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-dollar', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, 'user-admin-001',
         '2026-08-06T09:00:00.000Z', '2026-08-06T10:00:00.000Z', 'BOOKED', 'REGULAR')`,
    ).run('appt-rem-dollar', context.clinicId, now, now, 'patient-dollar');

    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.sourceId === 'appt-rem-dollar');
    expect(item).toBeDefined();
    expect(item?.content).toContain('$&');
    expect(item?.content).not.toContain('{patientName}');
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

  it('exposes patient wechat id on reminders', () => {
    db.prepare(
      `DELETE FROM Setting WHERE clinicId = ? AND key IN (
         'wechatReminder.enabled',
         'wechatReminder.appointmentDaysBefore',
         'wechatReminder.recallDaysAfter',
         'wechatReminder.firstExamDaysAfter'
       )`,
    ).run(context.clinicId);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, wechatId, preferredContact, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'P-WX-REM', 'Wechat Reminder Patient', 'UNKNOWN', '13900000000', 'wx_rem', 'WECHAT', 'WALK_IN', 1)`,
    ).run('patient-wechat-rem', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appt-wechat-id-rem', context.clinicId, now, now, 'patient-wechat-rem', 'user-admin-001', '2026-08-06T09:00:00.000Z', '2026-08-06T10:00:00.000Z');
    const service = new WechatReminderService(db);
    const result = service.today(context);
    const item = result.items.find((row) => row.sourceId === 'appt-wechat-id-rem');
    expect(item?.patientWechatId).toBe('wx_rem');
  });

  it('generates reminders beyond a single 1000-row candidate page', () => {
    for (let i = 0; i < 1001; i += 1) {
      const hour = String(Math.floor(i / 60) % 16).padStart(2, '0');
      const minute = String(i % 60).padStart(2, '0');
      insertAppointment(`appt-bulk-${i}`, `2026-08-06T${hour}:${minute}:00.000Z`);
    }
    const service = new WechatReminderService(db);
    const result = service.today(context);
    const count = (db.prepare(
      `SELECT COUNT(*) AS c FROM WechatReminder
       WHERE clinicId = ? AND status = 'PENDING' AND sourceId LIKE 'appt-bulk-%'`,
    ).get(context.clinicId) as { c: number }).c;
    expect(count).toBe(1001);
    expect(result.truncated).toBe(true);
    expect(db.prepare('SELECT 1 FROM WechatReminder WHERE sourceId = ?').get('appt-bulk-1000')).toBeDefined();
  });

  it('updates reminder config settings and validates bounds', () => {
    // 先写入一行，覆盖 update 路径；未写过的键覆盖 insert 路径
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, 'wechatReminder.appointmentDaysBefore', '1')`,
    ).run('setting-appt-days', context.clinicId, now, now);

    const service = new WechatReminderService(db);
    const config = service.updateConfig(
      { enabled: false, appointmentDaysBefore: 7, firstExamDaysAfter: 0, recallContent: '回顾内容' },
      context,
    );
    expect(config.enabled).toBe(false);
    expect(config.appointmentDaysBefore).toBe(7);
    expect(config.firstExamDaysAfter).toBe(0);
    expect(config.recallContent).toBe('回顾内容');
    // 更新路径与插入路径都落库
    const row = db.prepare(
      `SELECT value FROM Setting WHERE key = ? AND clinicId = ? AND deletedAt IS NULL`,
    ).get('wechatReminder.appointmentDaysBefore', context.clinicId) as { value: string };
    expect(row.value).toBe('7');
    expect(db.prepare(
      `SELECT value FROM Setting WHERE key = 'wechatReminder.firstExamDaysAfter' AND clinicId = ? AND deletedAt IS NULL`,
    ).get(context.clinicId)).toBeDefined();
  });

  it('rejects invalid reminder config values', () => {
    const service = new WechatReminderService(db);
    expect(() => service.updateConfig({ appointmentDaysBefore: 1.5 }, context)).toThrow('must be an integer between 0 and 365');
    expect(() => service.updateConfig({ appointmentDaysBefore: -1 }, context)).toThrow('must be an integer between 0 and 365');
    expect(() => service.updateConfig({ recallDaysAfter: 366 }, context)).toThrow('must be an integer between 0 and 365');
    expect(() => service.updateConfig({ firstExamContent: 'x'.repeat(2001) }, context)).toThrow('must be a string up to 2000 characters');
    expect(() => service.updateConfig({ firstExamContent: 42 as unknown as string }, context)).toThrow('must be a string up to 2000 characters');
    // 校验失败不得残留部分写入
    expect(db.prepare(
      `SELECT 1 FROM Setting WHERE key = 'wechatReminder.appointmentDaysBefore' AND clinicId = ? AND deletedAt IS NULL`,
    ).get(context.clinicId)).toBeUndefined();
  });

  it('caches today generation within the TTL and clears explicitly', () => {
    const service = new WechatReminderService(db);
    service.today(context);
    // TTL 内新增候选：缓存命中路径不会重新生成
    insertAppointment('appt-cache-miss', '2026-08-06T09:00:00.000Z');
    const second = service.today(context);
    expect(second.items.some((row) => row.sourceId === 'appt-cache-miss')).toBe(false);
    // 显式清缓存后重新生成
    service.clearTodayGeneratedCache();
    const third = service.today(context);
    expect(third.items.some((row) => row.sourceId === 'appt-cache-miss')).toBe(true);
  });

  it('formats appointment time in the clinic timezone (+8)', () => {
    insertAppointment('appt-tz-1', '2026-08-05T23:30:00.000Z');
    const service = new WechatReminderService(db);
    const item = service.today(context).items.find((row) => row.sourceId === 'appt-tz-1');
    expect(item).toBeDefined();
    expect(item?.content).toContain('07:30');
  });

  it('accepts boundary day values of 0 and 365 and falls back for invalid values', () => {
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, 'wechatReminder.recallDaysAfter', '0')`,
    ).run('setting-recall-zero', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, 'wechatReminder.firstExamDaysAfter', '365')`,
    ).run('setting-exam-365', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, 'wechatReminder.appointmentDaysBefore', 'abc')`,
    ).run('setting-appt-abc', context.clinicId, now, now);
    const service = new WechatReminderService(db);
    const config = service.config(context);
    expect(config.recallDaysAfter).toBe(0);
    expect(config.firstExamDaysAfter).toBe(365);
    expect(config.appointmentDaysBefore).toBe(1); // 非法值回退默认
  });

  it('handles a null clinic context with a global cache key', () => {
    const service = new WechatReminderService(db);
    const globalContext: AppContext = { ...context, clinicId: null };
    const result = service.today(globalContext);
    expect(result.config.enabled).toBe(true);
    expect(result.date).toBe('2026-08-05');
  });

  it('pages recall candidates beyond 1000 rows', () => {
    for (let i = 0; i < 1001; i += 1) {
      insertVisit(`visit-bulk-${i}`, '2026-08-02T08:00:00.000Z');
    }
    const service = new WechatReminderService(db);
    service.today(context);
    const count = (db.prepare(
      `SELECT COUNT(*) AS c FROM WechatReminder
       WHERE clinicId = ? AND status = 'PENDING' AND sourceId LIKE 'visit-bulk-%'`,
    ).get(context.clinicId) as { c: number }).c;
    expect(count).toBe(1001);
  });

  it('pages first-exam candidates beyond 1000 rows', () => {
    for (let i = 0; i < 1001; i += 1) {
      insertFirstExam(`exam-bulk-${i}`, '2026-08-02T02:00:00.000Z', null);
    }
    const service = new WechatReminderService(db);
    service.today(context);
    const count = (db.prepare(
      `SELECT COUNT(*) AS c FROM WechatReminder
       WHERE clinicId = ? AND status = 'PENDING' AND sourceId LIKE 'exam-bulk-%'`,
    ).get(context.clinicId) as { c: number }).c;
    expect(count).toBe(1001);
  });

  it('reports truncated false exactly at the list limit', () => {
    for (let i = 0; i < 1000; i += 1) {
      const hour = String(Math.floor(i / 60) % 16).padStart(2, '0');
      const minute = String(i % 60).padStart(2, '0');
      insertAppointment(`appt-exact-${i}`, `2026-08-06T${hour}:${minute}:00.000Z`);
    }
    const service = new WechatReminderService(db);
    const result = service.today(context);
    expect(result.items).toHaveLength(1000);
    expect(result.truncated).toBe(false);
  });
});
