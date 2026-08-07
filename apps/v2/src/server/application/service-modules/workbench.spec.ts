import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ClinicalWorkbenchService } from './workbench';
import type { AppContext } from '../../../domain/contracts';

describe('ClinicalWorkbenchService', () => {
  let dataDir: string;
  let db: Database.Database;
  let context: AppContext;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-workbench-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };

    // 种子数据中的演示预约使用真实当前时间，可能与固定测试日期重叠；
    // 将其移到遥远的未来，保证断言只依赖本用例插入的数据。
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    // 今天（2026-08-05）的挂号
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt, chiefComplaint
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'REGULAR', 'REGISTERED', ?, ?)`,
    ).run('reg-today', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T01:00:00.000Z', '牙痛');
    // 昨天的挂号：不应出现在今日列表
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt, chiefComplaint
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'REGULAR', 'REGISTERED', ?, ?)`,
    ).run('reg-yesterday', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-04T01:00:00.000Z', '牙痛');
    // 今天但其他诊所的挂号：租户过滤应排除
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt, chiefComplaint
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'REGULAR', 'REGISTERED', ?, ?)`,
    ).run('reg-other-clinic', 'clinic-other', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T02:00:00.000Z', '牙痛');
    // 今天但已取消的挂号：状态过滤应排除
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt, chiefComplaint
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'REGULAR', 'CANCELLED', ?, ?)`,
    ).run('reg-cancelled', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T03:00:00.000Z', '牙痛');

    // 今天的预约
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appt-today', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T09:00:00.000Z', '2026-08-05T10:00:00.000Z');
    // 昨天的预约：不应出现在今日列表
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appt-yesterday', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-04T09:00:00.000Z', '2026-08-04T10:00:00.000Z');

    // 今天进行中的就诊
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'IN_PROGRESS')`,
    ).run('visit-today', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T08:00:00.000Z');
    // 今天已完成/昨天的就诊：不计入进行中
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'COMPLETED')`,
    ).run('visit-completed', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T07:00:00.000Z');
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'IN_PROGRESS')`,
    ).run('visit-yesterday', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-04T08:00:00.000Z');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns only today rows with joined patient/doctor names and correct totals', () => {
    const service = new ClinicalWorkbenchService(db);
    const result = service.today(context) as {
      date: string;
      registrations: Array<Record<string, unknown>>;
      appointments: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };

    expect(result.date).toBe('2026-08-05');
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0]).toMatchObject({
      id: 'reg-today',
      patientId: 'patient-demo-001',
      patientName: 'Demo Patient',
      doctorId: 'user-admin-001',
      doctorName: 'System Administrator',
      status: 'REGISTERED',
      registeredAt: '2026-08-05T01:00:00.000Z',
      chiefComplaint: '牙痛',
      visitId: null,
    });
    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      id: 'appt-today',
      patientName: 'Demo Patient',
      doctorName: 'System Administrator',
      status: 'BOOKED',
      type: 'REGULAR',
    });
    expect(result.totals).toEqual({ registrations: 1, appointments: 1, inProgressVisits: 1 });
  });

  it('returns zero totals when no rows match the requested day', () => {
    const service = new ClinicalWorkbenchService(db);
    const result = service.today({
      ...context,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    }) as {
      date: string;
      registrations: Array<Record<string, unknown>>;
      appointments: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };

    expect(result.date).toBe('2030-01-01');
    expect(result.registrations).toHaveLength(0);
    expect(result.appointments).toHaveLength(0);
    expect(result.totals).toEqual({ registrations: 0, appointments: 0, inProgressVisits: 0 });
  });

  it('does not include soft-deleted rows', () => {
    const now = '2026-08-05T10:00:00.000Z';
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'REGULAR', 'REGISTERED', ?)`,
    ).run('reg-deleted', 'clinic-v2-001', now, now, now, 'patient-demo-001', 'user-admin-001', '2026-08-05T04:00:00.000Z');
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appt-deleted', 'clinic-v2-001', now, now, now, 'patient-demo-001', 'user-admin-001', '2026-08-05T11:00:00.000Z', '2026-08-05T12:00:00.000Z');
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
    ).run('visit-deleted', 'clinic-v2-001', now, now, now, 'patient-demo-001', 'user-admin-001', '2026-08-05T12:00:00.000Z');

    const service = new ClinicalWorkbenchService(db);
    const result = service.today(context) as {
      registrations: Array<Record<string, unknown>>;
      appointments: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };

    expect(result.registrations.some((row) => row.id === 'reg-deleted')).toBe(false);
    expect(result.appointments.some((row) => row.id === 'appt-deleted')).toBe(false);
    expect(result.totals).toEqual({ registrations: 1, appointments: 1, inProgressVisits: 1 });
  });
});
