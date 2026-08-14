// FollowUpService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
// 注意：测试顺序自聚合文件原样保留（CSV 上限测试对当日行数做精确断言，
// 依赖同文件内前序测试的写入状态）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { FollowUpService, maskPhoneForExport } from './follow-up-service';
import { SystemClock } from '../../infrastructure/clock';
import type { AppContext } from '../../../domain/contracts';

describe('FollowUpService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-followup-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('dedupes follow-up generation when no templates exist', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare('DELETE FROM FollowUpTemplate').run();
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-followup-null-template', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'user-admin-001', 'T-NULL', 'T', 'GENERAL', 100, 1, 'COMPLETED', ?)`,
    ).run('treatment-followup-null-template', context.clinicId, now, now, 'visit-followup-null-template', now.slice(0, 10));
    const first = await service.batchGenerate(2, context);
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const second = await service.batchGenerate(2, context);
    expect(second.generated).toBe(0);
  });

  it('rejects invalid completed dates during follow-up generation', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FollowUpTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, daysAfter, content, isEnabled
       ) VALUES (?, ?, ?, ?, NULL, 'Bad Date Template', 1, 'bad date', 1)`,
    ).run('template-bad-date', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-followup-bad-date', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'user-admin-001', 'T-BAD', 'T', 'GENERAL', 100, 1, 'COMPLETED', 'not-a-date')`,
    ).run('treatment-followup-bad-date', context.clinicId, now, now, 'visit-followup-bad-date');
    await expect(service.batchGenerate(2, context)).rejects.toThrow('Completed date is invalid');
  });

  it('completes follow-ups with clinic scope and status checks', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Complete me', 'PENDING')`,
    ).run('followup-complete', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-complete', context)).toMatchObject({ id: 'followup-complete', status: 'COMPLETED' });
    expect(() => service.complete('followup-complete', context)).toThrow('cannot be completed from current status');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'In progress', 'IN_PROGRESS')`,
    ).run('followup-in-progress', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-in-progress', context).status).toBe('COMPLETED');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'With result', 'PENDING')`,
    ).run('followup-result', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-result', context, ' 已回访 ')).toMatchObject({
      id: 'followup-result',
      status: 'COMPLETED',
      result: '已回访',
    });

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Long result', 'PENDING')`,
    ).run('followup-long-result', context.clinicId, now, now, now.slice(0, 10));
    expect(() => service.complete('followup-long-result', context, 'x'.repeat(501)))
      .toThrow('at most 500 characters');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Other clinic', 'PENDING')`,
    ).run('followup-other-clinic', 'clinic-v2-other', now, now, now.slice(0, 10));
    expect(() => service.complete('followup-other-clinic', context)).toThrow('Follow-up not found');
    expect(() => service.complete('missing-followup', context)).toThrow('Follow-up not found');

    const failingRepository = new FollowUpService(db, {
      reminders: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      insert: () => undefined,
      complete: () => 0,
    });
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Race guard', 'PENDING')`,
    ).run('followup-race-guard', context.clinicId, now, now, now.slice(0, 10));
    expect(() => failingRepository.complete('followup-race-guard', context)).toThrow('cannot be completed');
  });

  it('summarizes active follow-up reminders by due state', () => {
    const service = new FollowUpService(db);
    const clock = new SystemClock();
    const today = clock.clinicDate();
    const yesterday = clock.clinicDate(Date.now() - 86_400_000);
    const tomorrow = clock.clinicDate(Date.now() + 86_400_000);
    const now = new Date().toISOString();
    const insert = (id: string, clinicId: string | null, planDate: string, status = 'PENDING') => {
      db.prepare(
        `INSERT INTO FollowUp (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, planDate, content, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'summary', ?)`,
      ).run(id, clinicId, now, now, planDate, status);
    };
    const baseline = service.summary(context);
    const nullBaseline = service.summary({ ...context, clinicId: null });
    insert('followup-summary-overdue', context.clinicId, yesterday);
    insert('followup-summary-today', context.clinicId, today);
    insert('followup-summary-upcoming', context.clinicId, tomorrow, 'IN_PROGRESS');
    insert('followup-summary-completed', context.clinicId, tomorrow, 'COMPLETED');
    insert('followup-summary-other-clinic', 'clinic-v2-other', yesterday);
    insert('followup-summary-null-clinic', null, tomorrow);

    const scoped = service.summary(context);
    // 严格租户隔离：NULL clinicId 行对 scoped 查询不可见。
    expect(scoped.total - baseline.total).toBe(3);
    expect(scoped.overdue - baseline.overdue).toBe(1);
    expect(scoped.today - baseline.today).toBe(1);
    expect(scoped.upcoming - baseline.upcoming).toBe(1);
    // unscoped 全局视图能看见全部非 COMPLETED 插入（含 other-clinic 与 null-clinic 行）。
    const unscoped = service.summary({ ...context, clinicId: null });
    expect(unscoped.total - nullBaseline.total).toBe(5);
    expect(unscoped.overdue - nullBaseline.overdue).toBe(2);
    expect(unscoped.today - nullBaseline.today).toBe(1);
    expect(unscoped.upcoming - nullBaseline.upcoming).toBe(2);
  });

  it('batch completes follow-ups and exports reminder CSV', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    const insert = (id: string, planDate: string, status = 'PENDING') => {
      db.prepare(
        `INSERT INTO FollowUp (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, planDate, content, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'batch', ?)`,
      ).run(id, context.clinicId, now, now, planDate, status);
    };
    insert('followup-batch-ok', '2026-08-01');
    insert('followup-batch-completed', '2026-08-02', 'COMPLETED');

    const batch = service.batchComplete(
      ['followup-batch-ok', 'followup-batch-completed', 'followup-batch-missing'],
      context,
      '  done  ',
    );
    expect(batch).toMatchObject({ completed: 1, skipped: 2 });
    expect(batch.errors.join(' ')).toContain('当前状态不能完成随访');
    expect(batch.errors.join(' ')).toContain('随访记录不存在');
    insert('followup-batch-zero', '2026-08-01');
    const failingBatch = new FollowUpService(db, {
      reminders: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      insert: () => undefined,
      complete: () => 0,
    });
    expect(failingBatch.batchComplete(['followup-batch-zero'], context).errors.join(' '))
      .toContain('随访无法完成');
    expect(() => service.batchComplete([], context)).toThrow('1 to 500');
    expect(() => service.batchComplete(Array.from({ length: 501 }, (_, index) => `id-${index}`), context))
      .toThrow('1 to 500');
    expect(() => service.batchComplete(['followup-batch-ok'], context, 'x'.repeat(501)))
      .toThrow('at most 500 characters');

    const today = new SystemClock().clinicDate();
    const yesterday = new SystemClock().clinicDate(Date.now() - 86_400_000);
    const tomorrow = new SystemClock().clinicDate(Date.now() + 86_400_000);
    insert('followup-batch-export-overdue', yesterday);
    insert('followup-batch-export-today', today);
    insert('followup-batch-export-upcoming', tomorrow);
    const overdueCsv = service.remindersCsv('overdue', context);
    expect(overdueCsv).toContain('患者');
    expect(overdueCsv).toContain('followup-batch-export-overdue');
    expect(overdueCsv).not.toContain('followup-batch-export-today');
    expect(service.remindersCsv('today', context)).toContain('followup-batch-export-today');
    expect(service.remindersCsv('upcoming', context)).toContain('followup-batch-export-upcoming');
    expect(service.remindersCsv('all', context)).toContain('followup-batch-export-overdue');
    expect(() => service.remindersCsv('bad-scope', context)).toThrow('overdue, today, upcoming, or all');
  });

  it('caps follow-up CSV exports and marks truncation', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    const today = new SystemClock().clinicDate();
    for (let index = 0; index < 7; index += 1) {
      db.prepare(
        `INSERT INTO FollowUp (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, planDate, content, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, ?, 'PENDING')`,
      ).run(`followup-csv-cap-${index}`, context.clinicId, now, now, today, `cap-${index}`);
    }
    const csv = service.remindersCsv('today', context, 5);
    const dataLines = csv.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
    expect(dataLines.length).toBe(6);
    expect(csv).toContain('# truncated');
  });

  it('masks phones and guards formula injection in follow-up CSV exports', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    // 恶意患者：姓名与电话均以公式字符开头（CWE-1236）。
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'P-CSV-EVIL', '=1+1', 'UNKNOWN', '=SUM(1,2)', '[]', '', '', '', '', 'OTHER', 1)`,
    ).run('patient-csv-evil', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-csv-evil', '2026-08-01', 'evil', 'PENDING')`,
    ).run('followup-csv-evil', context.clinicId, now, now);
    const csv = service.remindersCsv('all', context);
    // 公式注入防护：= 前缀的单元格以单引号转义（姓名未掩码，走 csvCell 防护）。
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).not.toContain('"=1+1"');
    // 电话先经掩码处理：=SUM(1,2) 无 7 位以上数字 → 全掩为星号，原始公式不出现在导出中。
    expect(csv).not.toContain('=SUM(1,2)');
    expect(csv).toContain('"*********"');
    // 种子患者电话 13800000000 导出时被掩码为 138****0000。
    expect(csv).toContain('138****0000');
    expect(csv).not.toContain('13800000000');
    // 掩码函数边界：短号全掩、空值返回空串。
    expect(maskPhoneForExport('13812345678')).toBe('138****5678');
    expect(maskPhoneForExport('12345')).toBe('*****');
    expect(maskPhoneForExport(null)).toBe('');
    expect(maskPhoneForExport(undefined)).toBe('');
  });
});
