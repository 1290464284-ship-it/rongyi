import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { FirstExamRestartService, type ChiefMark, type Dentition, type SetChiefMarkInput, type SetDentitionInput } from './first-exam-restart';

describe('FirstExamRestartService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-first-exam-restart-'));
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

  function insertExam(id: string, overrides: Record<string, unknown> = {}): void {
    const base = {
      clinicId: context.clinicId,
      createdAt: now,
      updatedAt: now,
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      consultantId: 'user-admin-001',
      chiefComplaint: '牙痛',
      presentIllness: '右上后牙疼痛一周',
      pastHistory: '既往体健',
      oralExam: '16 深龋',
      auxiliaryExam: 'X 线示 16 龋坏近髓',
      diagnosis: '16 深龋',
      treatmentSuggestion: '建议根管治疗',
      status: 'COMPLETED',
      remark: '初次检查',
      followUpStatus: 'PENDING',
      dentition: 'DECIDUOUS',
      ...overrides,
    };
    db.prepare(
      `INSERT INTO FirstExam (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, consultantId,
         chiefComplaint, presentIllness, pastHistory, oralExam, auxiliaryExam,
         diagnosis, treatmentSuggestion, status, remark,
         followUpStatus, dentition
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, base.clinicId, base.createdAt, base.updatedAt,
      base.patientId, base.doctorId, base.consultantId,
      base.chiefComplaint, base.presentIllness, base.pastHistory, base.oralExam, base.auxiliaryExam,
      base.diagnosis, base.treatmentSuggestion, base.status, base.remark,
      base.followUpStatus, base.dentition,
    );
  }

  function insertTooth(id: string, examId: string, overrides: Record<string, unknown> = {}): void {
    const base = {
      clinicId: context.clinicId,
      toothNumber: 16,
      toothStatus: 'CARIES',
      diseases: '[]',
      isChief: 0,
      chiefMark: 'NONE',
      ...overrides,
    };
    db.prepare(
      `INSERT INTO FirstExamTooth (
         id, clinicId, createdAt, updatedAt, deletedAt,
         examId, toothNumber, toothStatus, diseases, isChief, chiefMark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(id, base.clinicId, now, now, examId, base.toothNumber, base.toothStatus, base.diseases, base.isChief, base.chiefMark);
  }

  it('restart copies clinical fields, links the previous exam, and keeps the original untouched without copying teeth', () => {
    insertExam('exam-orig-1', { createdAt: '2026-08-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z' });
    insertTooth('tooth-orig-1', 'exam-orig-1');

    const service = new FirstExamRestartService(db);
    const created = service.restart('exam-orig-1', {}, context);

    expect(created.id).toBeDefined();
    expect(created.id).not.toBe('exam-orig-1');
    expect(created.patientId).toBe('patient-demo-001');
    expect(created.doctorId).toBe('user-admin-001');
    expect(created.consultantId).toBe('user-admin-001');
    expect(created.chiefComplaint).toBe('牙痛');
    expect(created.presentIllness).toBe('右上后牙疼痛一周');
    expect(created.pastHistory).toBe('既往体健');
    expect(created.oralExam).toBe('16 深龋');
    expect(created.auxiliaryExam).toBe('X 线示 16 龋坏近髓');
    expect(created.diagnosis).toBe('16 深龋');
    expect(created.treatmentSuggestion).toBe('建议根管治疗');
    expect(created.status).toBe('IN_PROGRESS');
    expect(created.followUpStatus).toBe('NONE');
    expect(created.remark).toBe('重启检查');
    expect(created.dentition).toBe('DECIDUOUS');
    expect(created.previousExamId).toBe('exam-orig-1');
    expect(created.restartedAt).toBe(now);
    expect(created.createdAt).toBe(now);

    // 原记录不修改
    const original = db.prepare('SELECT * FROM FirstExam WHERE id = ?').get('exam-orig-1') as Record<string, unknown>;
    expect(original.status).toBe('COMPLETED');
    expect(original.remark).toBe('初次检查');
    expect(original.previousExamId).toBeNull();
    expect(original.restartedAt).toBeNull();

    // 不复制牙齿明细：新记录无牙齿，旧记录牙齿保留
    const newTeeth = db.prepare('SELECT COUNT(*) AS c FROM FirstExamTooth WHERE examId = ?').get(created.id) as { c: number };
    expect(newTeeth.c).toBe(0);
    const oldTeeth = db.prepare('SELECT COUNT(*) AS c FROM FirstExamTooth WHERE examId = ?').get('exam-orig-1') as { c: number };
    expect(oldTeeth.c).toBe(1);
  });

  it('restart honors explicit doctorId and dentition overrides', () => {
    insertExam('exam-orig-2', { doctorId: 'user-admin-001', dentition: 'MIXED' });
    const service = new FirstExamRestartService(db);
    const created = service.restart('exam-orig-2', { doctorId: 'user-seed-doctor-001', dentition: 'PERMANENT' }, context);
    expect(created.doctorId).toBe('user-seed-doctor-001');
    expect(created.dentition).toBe('PERMANENT');
    expect(created.previousExamId).toBe('exam-orig-2');
    expect(created.status).toBe('IN_PROGRESS');
  });

  it('restart throws NotFoundError when the exam does not exist', () => {
    const service = new FirstExamRestartService(db);
    expect(() => service.restart('missing-exam', {}, context)).toThrow(NotFoundError);
  });

  it('restart rejects invalid dentition values', () => {
    insertExam('exam-bad-dent');
    const service = new FirstExamRestartService(db);
    expect(() => service.restart('exam-bad-dent', { dentition: 'BOGUS' as Dentition }, context))
      .toThrow('Invalid dentition');
  });

  it('restart propagates null optional fields from the original exam', () => {
    insertExam('exam-null-fields', {
      consultantId: null,
      chiefComplaint: null,
      presentIllness: null,
      pastHistory: null,
      oralExam: null,
      auxiliaryExam: null,
      diagnosis: null,
      treatmentSuggestion: null,
      dentition: null,
    });
    const service = new FirstExamRestartService(db);
    const created = service.restart('exam-null-fields', {}, context);
    expect(created.consultantId).toBeNull();
    expect(created.chiefComplaint).toBeNull();
    expect(created.presentIllness).toBeNull();
    expect(created.pastHistory).toBeNull();
    expect(created.oralExam).toBeNull();
    expect(created.auxiliaryExam).toBeNull();
    expect(created.diagnosis).toBeNull();
    expect(created.treatmentSuggestion).toBeNull();
    expect(created.dentition).toBeNull();
  });

  it('setDentition rejects an absent dentition value', () => {
    insertExam('exam-dent-empty');
    const service = new FirstExamRestartService(db);
    expect(() => service.setDentition('exam-dent-empty', {} as SetDentitionInput, context))
      .toThrow('Invalid dentition');
  });

  it('setChiefMark rejects an absent chief mark value', () => {
    insertExam('exam-mark-empty');
    insertTooth('tooth-mark-empty', 'exam-mark-empty');
    const service = new FirstExamRestartService(db);
    expect(() => service.setChiefMark('exam-mark-empty', 'tooth-mark-empty', {} as SetChiefMarkInput, context))
      .toThrow('Invalid chiefMark');
  });

  it('setDentition updates the dentition and rejects invalid values', () => {
    insertExam('exam-dent-1');
    const service = new FirstExamRestartService(db);
    const result = service.setDentition('exam-dent-1', { dentition: 'MIXED' }, context);
    expect(result).toEqual({ examId: 'exam-dent-1', dentition: 'MIXED' });

    const row = db.prepare('SELECT dentition, updatedAt FROM FirstExam WHERE id = ?').get('exam-dent-1') as { dentition: string; updatedAt: string };
    expect(row.dentition).toBe('MIXED');
    expect(row.updatedAt).toBe(now);

    expect(() => service.setDentition('exam-dent-1', { dentition: 'UNKNOWN' as Dentition }, context)).toThrow(ValidationError);
    expect(() => service.setDentition('missing-exam', { dentition: 'PERMANENT' }, context)).toThrow(NotFoundError);
  });

  it('setChiefMark updates the tooth mark within the same exam and rejects invalid values', () => {
    insertExam('exam-mark-1');
    insertTooth('tooth-mark-1', 'exam-mark-1', { toothNumber: 26 });
    const service = new FirstExamRestartService(db);
    const result = service.setChiefMark('exam-mark-1', 'tooth-mark-1', { chiefMark: 'HORIZONTAL_DONE' }, context);
    expect(result).toEqual({ toothId: 'tooth-mark-1', chiefMark: 'HORIZONTAL_DONE' });

    const row = db.prepare('SELECT chiefMark, updatedAt FROM FirstExamTooth WHERE id = ?').get('tooth-mark-1') as { chiefMark: string; updatedAt: string };
    expect(row.chiefMark).toBe('HORIZONTAL_DONE');
    expect(row.updatedAt).toBe(now);

    expect(() => service.setChiefMark('exam-mark-1', 'tooth-mark-1', { chiefMark: 'SOMETHING' as ChiefMark }, context)).toThrow(ValidationError);
  });

  it('setChiefMark rejects a tooth that belongs to another exam', () => {
    insertExam('exam-mark-a');
    insertExam('exam-mark-b');
    insertTooth('tooth-mark-b1', 'exam-mark-b');
    const service = new FirstExamRestartService(db);
    expect(() => service.setChiefMark('exam-mark-a', 'tooth-mark-b1', { chiefMark: 'HORIZONTAL_SHOULD' }, context)).toThrow(NotFoundError);
    expect(() => service.setChiefMark('missing-exam', 'tooth-mark-b1', { chiefMark: 'NONE' }, context)).toThrow(NotFoundError);
  });

  it('history returns non-deleted exams for the patient ordered by createdAt desc', () => {
    insertExam('hist-1', { createdAt: '2026-08-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z', chiefComplaint: '旧主诉' });
    insertExam('hist-2', { createdAt: '2026-08-03T02:00:00.000Z', updatedAt: '2026-08-03T02:00:00.000Z', chiefComplaint: '新主诉' });
    db.prepare(
      `INSERT INTO FirstExam (id, clinicId, createdAt, updatedAt, deletedAt, patientId, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('hist-del', context.clinicId, '2026-08-02T02:00:00.000Z', '2026-08-02T02:00:00.000Z', '2026-08-04T02:00:00.000Z', 'patient-demo-001', 'NEW');

    const service = new FirstExamRestartService(db);
    const list = service.history('patient-demo-001', context);
    const histRows = list.filter((row) => row.id.startsWith('hist-'));
    expect(histRows.map((row) => row.id)).toEqual(['hist-2', 'hist-1']);
    expect(histRows[0].chiefComplaint).toBe('新主诉');
    expect(histRows[0].createdAt).toBe('2026-08-03T02:00:00.000Z');
    expect(histRows[0].dentition).toBe('DECIDUOUS');
    expect(histRows[0].followUpStatus).toBe('PENDING');
    expect(list.some((row) => row.id === 'hist-del')).toBe(false);

    expect(() => service.history('missing-patient', context)).toThrow(NotFoundError);
  });
});
