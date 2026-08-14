import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { TriageService, type RescheduleAppointmentInput, type TriageQueueQuery } from './triage';

describe('TriageService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-triage-'));
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
    for (const [id, name] of [['chair-1', '椅位 1'], ['chair-2', '椅位 2'], ['chair-9', '椅位 9']] as const) {
      db.prepare(
        `INSERT OR IGNORE INTO Chair (id, clinicId, createdAt, updatedAt, deletedAt, name, location, active)
         VALUES (?, ?, ?, ?, NULL, ?, 'Triage Room', 1)`,
      ).run(id, context.clinicId, now, now, name);
    }
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertDepartment(id: string, name: string): void {
    db.prepare(
      `INSERT INTO Department (id, clinicId, createdAt, updatedAt, deletedAt, name, active, sortOrder, remark)
       VALUES (?, ?, ?, ?, NULL, ?, 1, 0, NULL)`,
    ).run(id, context.clinicId, now, now, name);
  }

  function insertRegistration(
    id: string,
    overrides: Partial<{ status: string; departmentId: string | null; doctorId: string | null; registeredAt: string }> = {},
  ): void {
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, departmentId, type, status, triageNote, chiefComplaint,
         registeredBy, registeredAt, triagedAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, ?, 'REGULAR', ?, NULL, '牙痛三天',
         'user-admin-001', ?, NULL)`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      overrides.doctorId ?? null,
      overrides.departmentId ?? null,
      overrides.status ?? 'REGISTERED',
      overrides.registeredAt ?? '2026-08-05T09:00:00.000Z',
    );
  }

  function insertAppointment(
    id: string,
    overrides: Partial<{ startTime: string; endTime: string; doctorId: string; chairId: string | null; status: string }> = {},
  ): void {
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, chairId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, ?, ?, ?, ?, 'REGULAR')`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      overrides.doctorId ?? 'user-admin-001',
      overrides.chairId ?? null,
      overrides.startTime ?? '2099-02-01T09:00:00.000Z',
      overrides.endTime ?? '2099-02-01T10:00:00.000Z',
      overrides.status ?? 'BOOKED',
    );
  }

  it('triages a REGISTERED registration and updates department/doctor/note', () => {
    insertDepartment('dept-triage-1', '口腔内科');
    insertRegistration('reg-triage-1');

    const service = new TriageService(db);
    const result = service.triage('reg-triage-1', {
      departmentId: 'dept-triage-1',
      doctorId: 'user-admin-001',
      triageNote: '先拍全景片再就诊',
    }, context);

    expect(result.status).toBe('TRIAGED');
    expect(result.triagedAt).toBe(now);
    expect(result.departmentId).toBe('dept-triage-1');
    expect(result.doctorId).toBe('user-admin-001');
    expect(result.triageNote).toBe('先拍全景片再就诊');
    expect(result.updatedAt).toBe(now);

    const row = db.prepare('SELECT * FROM Registration WHERE id = ?').get('reg-triage-1') as Record<string, unknown>;
    expect(row.status).toBe('TRIAGED');
    expect(row.triagedAt).toBe(now);
    expect(row.departmentId).toBe('dept-triage-1');
    expect(row.doctorId).toBe('user-admin-001');
    expect(row.triageNote).toBe('先拍全景片再就诊');
  });

  it('triages without optional fields and keeps existing values untouched', () => {
    insertDepartment('dept-triage-keep', '口腔外科');
    insertRegistration('reg-triage-keep', { departmentId: 'dept-triage-keep' });

    const service = new TriageService(db);
    const result = service.triage('reg-triage-keep', {}, context);

    expect(result.status).toBe('TRIAGED');
    expect(result.triagedAt).toBe(now);
    expect(result.departmentId).toBe('dept-triage-keep');
    expect(result.triageNote).toBeNull();
  });

  it('rejects triaging a registration that is not REGISTERED', () => {
    insertRegistration('reg-triage-conflict', { status: 'IN_PROGRESS' });

    const service = new TriageService(db);
    expect(() => service.triage('reg-triage-conflict', {}, context)).toThrow(ConflictError);
  });

  it('throws NotFound for an unknown registration', () => {
    const service = new TriageService(db);
    expect(() => service.triage('reg-missing', {}, context)).toThrow(NotFoundError);
  });

  it('throws ValidationError when the department does not exist', () => {
    insertRegistration('reg-triage-dept');

    const service = new TriageService(db);
    expect(() => service.triage('reg-triage-dept', { departmentId: 'dept-ghost' }, context)).toThrow(ValidationError);
  });

  it('throws ValidationError when the doctor does not exist', () => {
    insertRegistration('reg-triage-doctor');

    const service = new TriageService(db);
    expect(() => service.triage('reg-triage-doctor', { doctorId: 'user-ghost' }, context)).toThrow(ValidationError);
  });

  it('returns the queue with joined patient/doctor/department names', () => {
    insertDepartment('dept-queue-1', '综合科');
    insertRegistration('reg-queue-1', { departmentId: 'dept-queue-1', doctorId: 'user-admin-001', registeredAt: '2026-08-05T08:30:00.000Z' });

    const service = new TriageService(db);
    const result = service.queue({}, context);

    expect(result.total).toBeGreaterThanOrEqual(1);
    const item = result.items.find((row) => row.id === 'reg-queue-1');
    expect(item).toBeDefined();
    expect(item?.patientId).toBe('patient-demo-001');
    expect(item?.patientName).toBe('Demo Patient');
    expect(item?.doctorId).toBe('user-admin-001');
    expect(item?.doctorName).toBe('System Administrator');
    expect(item?.departmentId).toBe('dept-queue-1');
    expect(item?.departmentName).toBe('综合科');
    expect(item?.status).toBe('REGISTERED');
    expect(item?.type).toBe('REGULAR');
    expect(item?.chiefComplaint).toBe('牙痛三天');
    expect(item?.registeredAt).toBe('2026-08-05T08:30:00.000Z');
    expect(item?.triagedAt).toBeNull();
  });

  it('filters the queue by departmentId', () => {
    insertDepartment('dept-queue-a', '正畸科');
    insertDepartment('dept-queue-b', '种植科');
    insertRegistration('reg-queue-dept-a', { departmentId: 'dept-queue-a', registeredAt: '2026-08-05T08:00:00.000Z' });
    insertRegistration('reg-queue-dept-b', { departmentId: 'dept-queue-b', registeredAt: '2026-08-05T08:10:00.000Z' });

    const service = new TriageService(db);
    const result = service.queue({ departmentId: 'dept-queue-a' }, context);

    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('reg-queue-dept-a');
    expect(result.items[0].departmentName).toBe('正畸科');
  });

  it('filters the queue by status and excludes other statuses', () => {
    insertRegistration('reg-queue-status-1', { registeredAt: '2026-08-05T07:00:00.000Z' });
    insertRegistration('reg-queue-status-2', { status: 'TRIAGED', registeredAt: '2026-08-05T07:10:00.000Z' });
    insertRegistration('reg-queue-status-3', { status: 'COMPLETED', registeredAt: '2026-08-05T07:20:00.000Z' });

    const service = new TriageService(db);
    const triaged = service.queue({ status: 'TRIAGED' }, context);

    const triagedIds = triaged.items.filter((row) => row.id.startsWith('reg-queue-status-')).map((row) => row.id);
    expect(triagedIds).toEqual(['reg-queue-status-2']);
    const registered = service.queue({ status: 'REGISTERED' }, context);
    const registeredIds = registered.items.filter((row) => row.id.startsWith('reg-queue-status-')).map((row) => row.id);
    expect(registeredIds).toEqual(['reg-queue-status-1']);
  });

  it('orders the queue by registeredAt ascending', () => {
    insertRegistration('reg-queue-order-1', { registeredAt: '2026-08-05T06:00:00.000Z' });
    insertRegistration('reg-queue-order-2', { registeredAt: '2026-08-05T06:30:00.000Z' });

    const service = new TriageService(db);
    const result = service.queue({}, context);
    const order = result.items.filter((row) => row.id.startsWith('reg-queue-order-'));
    expect(order.map((row) => row.id)).toEqual(['reg-queue-order-1', 'reg-queue-order-2']);
  });

  it('rejects an invalid queue status', () => {
    const service = new TriageService(db);
    expect(() => service.queue({ status: 'IN_PROGRESS' as TriageQueueQuery['status'] }, context)).toThrow(ValidationError);
    expect(() => service.queue({ status: 'COMPLETED' as TriageQueueQuery['status'] }, context)).toThrow(ValidationError);
  });

  it('reschedules an appointment (time, doctor, chair) and clears chairId', () => {
    insertAppointment('appt-reschedule-1', { chairId: 'chair-1', startTime: '2099-03-01T09:00:00.000Z' });

    const service = new TriageService(db);
    const result = service.rescheduleAppointment('appt-reschedule-1', {
      startTime: '2099-03-02T14:30:00.000Z',
      endTime: '2099-03-02T15:30:00.000Z',
      doctorId: 'user-admin-001',
      chairId: 'chair-2',
    }, context);

    expect(result.startTime).toBe('2099-03-02T14:30:00.000Z');
    expect(result.endTime).toBe('2099-03-02T15:30:00.000Z');
    expect(result.doctorId).toBe('user-admin-001');
    expect(result.chairId).toBe('chair-2');
    expect(result.updatedAt).toBe(now);

    // 前端拖拽清空椅位：null 与空串都视为清空。
    const cleared = service.rescheduleAppointment('appt-reschedule-1', { startTime: '2099-03-02T14:30:00.000Z', chairId: null }, context);
    expect(cleared.chairId).toBeNull();
    const clearedEmpty = service.rescheduleAppointment('appt-reschedule-1', { startTime: '2099-03-02T14:30:00.000Z', chairId: '' }, context);
    expect(clearedEmpty.chairId).toBeNull();
  });

  it('keeps endTime/doctorId/chairId untouched when not provided', () => {
    insertAppointment('appt-reschedule-2', { chairId: 'chair-9', startTime: '2099-04-01T09:00:00.000Z', endTime: '2099-04-03T10:00:00.000Z' });

    const service = new TriageService(db);
    const result = service.rescheduleAppointment('appt-reschedule-2', { startTime: '2099-04-02T10:00:00.000Z' }, context);

    expect(result.startTime).toBe('2099-04-02T10:00:00.000Z');
    expect(result.endTime).toBe('2099-04-03T10:00:00.000Z');
    expect(result.doctorId).toBe('user-admin-001');
    expect(result.chairId).toBe('chair-9');
  });

  it('throws ValidationError for an invalid or missing startTime', () => {
    insertAppointment('appt-reschedule-bad');

    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-bad', { startTime: 'not-a-date' }, context)).toThrow(ValidationError);
    expect(() => service.rescheduleAppointment('appt-reschedule-bad', { startTime: '' }, context)).toThrow(ValidationError);
    expect(() => service.rescheduleAppointment('appt-reschedule-bad', { endTime: '2026-08-05T11:00:00.000Z' } as unknown as RescheduleAppointmentInput, context)).toThrow(ValidationError);
  });

  it('throws ValidationError for an invalid endTime', () => {
    insertAppointment('appt-reschedule-bad-end');

    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-bad-end', { startTime: '2099-05-01T09:00:00.000Z', endTime: 'oops' }, context)).toThrow(ValidationError);
  });

  it('rejects impossible calendar dates when rescheduling', () => {
    insertAppointment('appt-reschedule-calendar');
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-calendar', {
      startTime: '2026-02-30T10:00:00.000Z',
      endTime: '2026-02-30T11:00:00.000Z',
    }, context)).toThrow(ValidationError);
  });

  it('throws NotFound for an unknown appointment', () => {
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-missing', { startTime: '2099-05-01T09:00:00.000Z' }, context)).toThrow(NotFoundError);
  });

  it('rejects reschedule when endTime is not later than startTime', () => {
    insertAppointment('appt-reschedule-range');
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-range', {
      startTime: '2099-06-01T09:00:00.000Z',
      endTime: '2099-06-01T09:00:00.000Z',
    }, context)).toThrow(ValidationError);
  });

  it('rejects reschedule with unknown doctor or chair', () => {
    insertAppointment('appt-reschedule-references', { startTime: '2099-07-01T09:30:00.000Z', endTime: '2099-07-01T10:30:00.000Z' });
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-references', {
      startTime: '2099-07-01T09:00:00.000Z',
      doctorId: 'missing-doctor',
    }, context)).toThrow(NotFoundError);
    expect(() => service.rescheduleAppointment('appt-reschedule-references', {
      startTime: '2099-07-01T09:00:00.000Z',
      chairId: 'missing-chair',
    }, context)).toThrow(NotFoundError);
  });

  it('rejects reschedule that conflicts with another appointment', () => {
    insertAppointment('appt-reschedule-base', { chairId: 'chair-1', startTime: '2099-08-01T09:00:00.000Z', endTime: '2099-08-01T10:00:00.000Z' });
    insertAppointment('appt-reschedule-conflict', { chairId: 'chair-1', startTime: '2099-08-01T09:00:00.000Z', endTime: '2099-08-01T10:00:00.000Z' });
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-conflict', {
      startTime: '2099-08-01T09:30:00.000Z',
      endTime: '2099-08-01T10:30:00.000Z',
    }, context)).toThrow(ConflictError);
  });

  it('rejects rescheduling cancelled or no-show appointments', () => {
    insertAppointment('appt-reschedule-cancelled', { status: 'CANCELLED' });
    insertAppointment('appt-reschedule-noshow', { status: 'NO_SHOW' });

    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-reschedule-cancelled', { startTime: '2099-03-05T09:00:00.000Z' }, context)).toThrow('已取消或未到的预约不能改期');
    expect(() => service.rescheduleAppointment('appt-reschedule-noshow', { startTime: '2099-03-05T09:00:00.000Z' }, context)).toThrow(ConflictError);
  });

  it('requires startTime with the dedicated message for every falsy form', () => {
    insertAppointment('appt-falsy-start');
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-falsy-start', { startTime: '' }, context))
      .toThrow('startTime 必填');
    expect(() => service.rescheduleAppointment('appt-falsy-start', { startTime: undefined as unknown as string }, context))
      .toThrow('startTime 必填');
    expect(() => service.rescheduleAppointment('appt-falsy-start', { startTime: null as unknown as string }, context))
      .toThrow('startTime 必填');
  });

  it('updates the stored doctor when a different doctorId is provided', () => {
    db.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt, username, passwordHash, name, role, active, loginAttempts, tokenVersion)
       VALUES ('user-doctor-triage', ?, ?, ?, NULL, 'triage-doctor', 'x', '分诊医生', 'DOCTOR', 1, 0, 0)`,
    ).run(context.clinicId, now, now);
    insertAppointment('appt-doc-change', {
      doctorId: 'user-admin-001',
      startTime: '2099-12-01T09:00:00.000Z',
      endTime: '2099-12-01T10:00:00.000Z',
    });
    const service = new TriageService(db);
    const result = service.rescheduleAppointment('appt-doc-change', {
      startTime: '2099-12-01T09:00:00.000Z',
      doctorId: 'user-doctor-triage',
    }, context);
    expect(result.doctorId).toBe('user-doctor-triage');
  });

  it('conflict check falls back to the stored doctor when doctorId is omitted', () => {
    insertAppointment('appt-fb-a', {
      doctorId: 'user-admin-001',
      startTime: '2099-12-02T09:00:00.000Z',
      endTime: '2099-12-02T10:00:00.000Z',
    });
    insertAppointment('appt-fb-b', {
      doctorId: 'user-admin-001',
      startTime: '2099-12-02T09:00:00.000Z',
      endTime: '2099-12-02T10:00:00.000Z',
    });
    const service = new TriageService(db);
    // 不带 doctorId 改期：冲突检测必须回退到库内已存医生 → 与 A 冲突
    expect(() => service.rescheduleAppointment('appt-fb-b', {
      startTime: '2099-12-02T09:30:00.000Z',
      endTime: '2099-12-02T10:30:00.000Z',
    }, context)).toThrow('医生或椅位在该时段已被占用');
  });

  it('rethrows unexpected doctor-check errors unchanged', () => {
    insertRegistration('reg-triage-doctor-err');
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('SELECT u.id FROM User u')) throw new Error('db exploded');
      return originalPrepare(sql);
    });
    try {
      expect(() => new TriageService(db).triage('reg-triage-doctor-err', { doctorId: 'user-x' }, context))
        .toThrow('db exploded');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('rejects triage when the CAS update matches no rows', () => {
    insertRegistration('reg-triage-cas');
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE Registration SET')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    try {
      expect(() => new TriageService(db).triage('reg-triage-cas', {}, context)).toThrow(ConflictError);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('falls back to an empty doctor string in the conflict check when both input and row lack a doctor', () => {
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, chairId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', NULL, NULL, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appt-null-doctor', context.clinicId, now, now, '2099-02-10T09:00:00.000Z', '2099-02-10T10:00:00.000Z');
    const service = new TriageService(db);
    const result = service.rescheduleAppointment('appt-null-doctor', {
      startTime: '2099-02-11T09:00:00.000Z',
      endTime: '2099-02-11T10:00:00.000Z',
    }, context);
    expect(result.startTime).toBe('2099-02-11T09:00:00.000Z');
  });

  it('rejects rescheduling when the CAS update matches no rows', () => {
    insertAppointment('appt-cas');
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE Appointment SET')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    try {
      // 目标时段必须与其他测试互斥（shuffle 下共享库会残留同槽位预约 → 冲突检测先于 CAS 抛错）
      expect(() => new TriageService(db).rescheduleAppointment('appt-cas', {
        startTime: '2099-04-11T09:00:00.000Z',
        endTime: '2099-04-11T10:00:00.000Z',
      }, context)).toThrow('已取消或未到的预约不能改期');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('tracks the reschedule write with a null clinic when the context has no clinic', () => {
    insertAppointment('appt-null-clinic');
    const result = new TriageService(db).rescheduleAppointment('appt-null-clinic', {
      startTime: '2099-02-11T09:00:00.000Z',
      endTime: '2099-02-11T10:00:00.000Z',
    }, { ...context, clinicId: null });
    expect(result.startTime).toBe('2099-02-11T09:00:00.000Z');
  });

  it('reschedule omitting chairId preserves the stored chair in conflict detection', () => {
    insertAppointment('appt-chair-keep-a', {
      doctorId: 'doctor-a',
      chairId: 'chair-1',
      startTime: '2099-11-01T09:00:00.000Z',
      endTime: '2099-11-01T10:00:00.000Z',
    });
    insertAppointment('appt-chair-keep-b', {
      doctorId: 'doctor-b',
      chairId: 'chair-1',
      startTime: '2099-11-01T09:00:00.000Z',
      endTime: '2099-11-01T10:00:00.000Z',
    });
    const service = new TriageService(db);
    expect(() => service.rescheduleAppointment('appt-chair-keep-a', {
      startTime: '2099-11-01T09:30:00.000Z',
      endTime: '2099-11-01T10:30:00.000Z',
    }, context)).toThrow('医生或椅位在该时段已被占用');
  });

  it('reschedule clearing the chair uses null in conflict detection', () => {
    insertAppointment('appt-chair-clear-a', {
      doctorId: 'doctor-e',
      chairId: 'chair-9',
      startTime: '2099-11-02T09:00:00.000Z',
      endTime: '2099-11-02T10:00:00.000Z',
    });
    insertAppointment('appt-chair-clear-b', {
      doctorId: 'doctor-f',
      chairId: '',
      startTime: '2099-11-02T09:00:00.000Z',
      endTime: '2099-11-02T10:00:00.000Z',
    });
    const service = new TriageService(db);
    const result = service.rescheduleAppointment('appt-chair-clear-a', {
      startTime: '2099-11-02T09:30:00.000Z',
      endTime: '2099-11-02T10:30:00.000Z',
      chairId: '',
    }, context);
    expect(result.chairId).toBeNull();
  });

  it('tracks the reschedule write with the clinic id for sync', () => {
    insertAppointment('appt-sync-clinic');
    new TriageService(db).rescheduleAppointment('appt-sync-clinic', {
      startTime: '2099-11-03T09:00:00.000Z',
      endTime: '2099-11-03T10:00:00.000Z',
    }, context);
    const sync = db.prepare(
      "SELECT clinicId, tableName, recordId, operation FROM SyncChange WHERE recordId = 'appt-sync-clinic'",
    ).get();
    expect(sync).toEqual({
      clinicId: 'clinic-v2-001',
      tableName: 'Appointment',
      recordId: 'appt-sync-clinic',
      operation: 'UPDATE',
    });
  });
});
