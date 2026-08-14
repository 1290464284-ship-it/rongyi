import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { ProcessingFlowService } from './processing-flow';

describe('ProcessingFlowService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-processing-flow-'));
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
    insertDictStep('step-model', '模型设计', 0);
    insertDictStep('step-tryon', '试戴', 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertOrder(id: string, number: string, status = 'SENT', clinicId = context.clinicId): void {
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalFee, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 100000, ?)`,
    ).run(id, clinicId, now, now, 'patient-demo-001', number, status);
  }

  function insertDictStep(id: string, name: string, sortOrder: number, active = 1, clinicId = context.clinicId): void {
    db.prepare(
      `INSERT OR IGNORE INTO ProcessingFlowStep (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, sortOrder, active
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(id, clinicId, now, now, name, sortOrder, active);
  }

  function insertOrderStep(
    orderId: string,
    id: string,
    stepId: string,
    stepName: string,
    status: string,
    sortOrder: number,
    completedAt: string | null = null,
    clinicId = context.clinicId,
  ): void {
    db.prepare(
      `INSERT INTO ProcessingOrderStep (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, stepId, stepName, status, sortOrder, completedAt
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(id, clinicId, now, now, orderId, stepId, stepName, status, sortOrder, completedAt);
  }

  function stepCount(orderId: string): number {
    return (db.prepare(
      `SELECT COUNT(*) AS c FROM ProcessingOrderStep WHERE orderId = ? AND deletedAt IS NULL`,
    ).get(orderId) as { c: number }).c;
  }

  it('ensureSteps 首次按词典顺序生成 PENDING 步骤', () => {
    insertOrder('po-flow-001', 'PF-001');
    insertDictStep('step-model', '模型设计', 0);
    insertDictStep('step-tryon', '试戴', 1);

    const service = new ProcessingFlowService(db);
    const steps = service.ensureSteps('po-flow-001', context);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      stepId: 'step-model',
      stepName: '模型设计',
      status: 'PENDING',
      sortOrder: 0,
      startedAt: null,
      completedAt: null,
    });
    expect(steps[1]).toMatchObject({ stepId: 'step-tryon', stepName: '试戴', status: 'PENDING', sortOrder: 1 });
  });

  it('重复 ensureSteps 不重复生成步骤', () => {
    insertOrder('po-flow-001', 'PF-001');
    const service = new ProcessingFlowService(db);
    const first = service.ensureSteps('po-flow-001', context);
    const second = service.ensureSteps('po-flow-001', context);
    expect(second).toHaveLength(first.length);
    expect(stepCount('po-flow-001')).toBe(2);
  });

  it('listSteps 返回步骤列表', () => {
    insertOrder('po-flow-001', 'PF-001');
    const service = new ProcessingFlowService(db);
    const steps = service.listSteps('po-flow-001', context);
    expect(steps.map((step) => step.stepName)).toEqual(['模型设计', '试戴']);
  });

  it('ensureSteps 对不存在的加工单抛 NotFound', () => {
    const service = new ProcessingFlowService(db);
    expect(() => service.ensureSteps('po-missing', context)).toThrow(NotFoundError);
    expect(() => service.listSteps('po-missing', context)).toThrow(NotFoundError);
  });

  it('registerStep 按顺序推进第一步为 DONE（completedAt/operatorId 正确）', () => {
    insertOrder('po-flow-002', 'PF-002');
    const service = new ProcessingFlowService(db);
    const steps = service.registerStep('po-flow-002', {}, context);

    expect(steps[0]).toMatchObject({
      stepId: 'step-model',
      status: 'DONE',
      completedAt: now,
      operatorId: 'user-admin-001',
    });
    expect(steps[1].status).toBe('PENDING');
    const row = db.prepare('SELECT status, completedAt, operatorId FROM ProcessingOrderStep WHERE orderId = ? ORDER BY sortOrder').all('po-flow-002') as Array<{
      status: string;
      completedAt: string | null;
      operatorId: string | null;
    }>;
    expect(row[0]).toEqual({ status: 'DONE', completedAt: now, operatorId: 'user-admin-001' });
    expect(row[1].status).toBe('PENDING');
  });

  it('registerStep 指定已完成步骤抛 Conflict', () => {
    insertOrder('po-flow-003', 'PF-003');
    const service = new ProcessingFlowService(db);
    service.registerStep('po-flow-003', { stepId: 'step-model' }, context);
    expect(() => service.registerStep('po-flow-003', { stepId: 'step-model' }, context)).toThrow(ConflictError);
  });

  it('registerStep 指定后续步骤抛 Validation', () => {
    insertOrder('po-flow-004', 'PF-004');
    const service = new ProcessingFlowService(db);
    expect(() => service.registerStep('po-flow-004', { stepId: 'step-tryon' }, context)).toThrow(ValidationError);
    expect(() => service.registerStep('po-flow-004', { stepId: 'step-ghost' }, context)).toThrow(ValidationError);
  });

  it('全部步骤完成后 registerStep 抛 Conflict', () => {
    insertOrder('po-flow-005', 'PF-005');
    const service = new ProcessingFlowService(db);
    service.registerStep('po-flow-005', {}, context);
    service.registerStep('po-flow-005', {}, context);
    expect(() => service.registerStep('po-flow-005', {}, context)).toThrow(ConflictError);
    const steps = service.listSteps('po-flow-005', context);
    expect(steps.every((step) => step.status === 'DONE')).toBe(true);
  });

  it('setStep 手动 IN_PROGRESS → DONE（startedAt/completedAt）', () => {
    insertOrder('po-flow-006', 'PF-006');
    const service = new ProcessingFlowService(db);
    service.ensureSteps('po-flow-006', context);

    const inProgress = service.setStep('po-flow-006', { stepId: 'step-model', status: 'IN_PROGRESS' }, context);
    expect(inProgress).toMatchObject({ stepId: 'step-model', status: 'IN_PROGRESS', startedAt: now, completedAt: null, operatorId: 'user-admin-001' });

    const done = service.setStep('po-flow-006', { stepId: 'step-model', status: 'DONE', remark: '手动完成' }, context);
    expect(done).toMatchObject({ stepId: 'step-model', status: 'DONE', startedAt: now, completedAt: now, remark: '手动完成' });
  });

  it('setStep 回退为 PENDING 清空时间并支持按 id 匹配', () => {
    insertOrder('po-flow-007', 'PF-007');
    const service = new ProcessingFlowService(db);
    const first = service.ensureSteps('po-flow-007', context)[0];
    service.setStep('po-flow-007', { stepId: first.id, status: 'IN_PROGRESS' }, context);
    const reset = service.setStep('po-flow-007', { stepId: first.id, status: 'PENDING' }, context);
    expect(reset).toMatchObject({ status: 'PENDING', startedAt: null, completedAt: null });
  });

  it('setStep 非法 status 抛 Validation', () => {
    insertOrder('po-flow-008', 'PF-008');
    const service = new ProcessingFlowService(db);
    expect(() => service.setStep('po-flow-008', { stepId: 'step-model', status: 'BOGUS' }, context)).toThrow(ValidationError);
  });

  it('setStep 找不到步骤抛 NotFound', () => {
    insertOrder('po-flow-009', 'PF-009');
    const service = new ProcessingFlowService(db);
    expect(() => service.setStep('po-flow-009', { stepId: 'step-ghost', status: 'DONE' }, context)).toThrow(NotFoundError);
  });

  it('stats 按期间统计 doneCount 与 inProgressCount', () => {
    // 独立诊所隔离统计，避免本文件其他用例的加工单影响计数
    const statsCtx = { ...context, clinicId: 'clinic-stats' };
    insertDictStep('st-step-model', '模型设计', 0, 1, 'clinic-stats');
    insertDictStep('st-step-tryon', '试戴', 1, 1, 'clinic-stats');
    const service = new ProcessingFlowService(db);

    // A：期间内完成 step-model（固定 now = 2026-08-05T10:00:00.000Z）
    insertOrder('po-stats-a', 'PF-STA', 'SENT', 'clinic-stats');
    service.registerStep('po-stats-a', {}, statsCtx);
    // B：完成于期间外（手动改写 completedAt 到 2026-08-03）
    insertOrder('po-stats-b', 'PF-STB', 'SENT', 'clinic-stats');
    service.registerStep('po-stats-b', {}, statsCtx);
    db.prepare(`UPDATE ProcessingOrderStep SET completedAt = ? WHERE orderId = ? AND stepId = 'st-step-model'`)
      .run('2026-08-03T10:00:00.000Z', 'po-stats-b');
    // C：当前 IN_PROGRESS
    insertOrder('po-stats-c', 'PF-STC', 'SENT', 'clinic-stats');
    service.ensureSteps('po-stats-c', statsCtx);
    service.setStep('po-stats-c', { stepId: 'st-step-model', status: 'IN_PROGRESS' }, statsCtx);
    // D：其他诊所，期间内完成，不应计入（无词典，直接插入步骤行）
    insertOrder('po-stats-d', 'PF-STD', 'SENT', 'clinic-other');
    insertOrderStep('po-stats-d', 'ostep-d-1', 'step-model', '模型设计', 'DONE', 0, now, 'clinic-other');

    const inPeriod = service.stats({ from: '2026-08-05', to: '2026-08-05' }, statsCtx);
    expect(inPeriod.from).toBe('2026-08-05');
    expect(inPeriod.to).toBe('2026-08-05');
    expect(inPeriod.steps.map((step) => step.stepName)).toEqual(['模型设计', '试戴']);
    expect(inPeriod.steps[0]).toMatchObject({ stepId: 'st-step-model', doneCount: 1, inProgressCount: 1 });
    expect(inPeriod.steps[1]).toMatchObject({ stepId: 'st-step-tryon', doneCount: 0, inProgressCount: 0 });

    const all = service.stats({}, statsCtx);
    expect(all.steps[0].doneCount).toBe(2);
    expect(all.steps[0].inProgressCount).toBe(1);

    const afterOnly = service.stats({ from: '2026-08-06' }, statsCtx);
    expect(afterOnly.steps[0].doneCount).toBe(0);
    expect(afterOnly.steps[0].inProgressCount).toBe(1);
  });

  it('stats 无词典步骤时按出现的 stepName 聚合', () => {
    const other = { ...context, clinicId: 'clinic-other' };
    const otherService = new ProcessingFlowService(db);
    insertOrder('po-stats-d', 'PF-STD', 'SENT', 'clinic-other');
    insertOrderStep('po-stats-d', 'ostep-d-1', 'step-model', '模型设计', 'DONE', 0, now, 'clinic-other');
    const result = otherService.stats({ from: '2026-08-05', to: '2026-08-05' }, other);
    // clinic-other 无词典步骤：聚合出现的步骤名（po-stats-d 的 模型设计 DONE）
    expect(result.steps.map((step) => step.stepName)).toEqual(['模型设计']);
    expect(result.steps[0]).toMatchObject({ stepId: 'step-model', doneCount: 1, inProgressCount: 0 });
  });

  it('ensureSteps 无词典步骤时返回空列表', () => {
    const other = { ...context, clinicId: 'clinic-empty-dict' };
    insertOrder('po-empty-dict', 'PF-EMPTY', 'SENT', 'clinic-empty-dict');
    const steps = new ProcessingFlowService(db).ensureSteps('po-empty-dict', other);
    expect(steps).toEqual([]);
  });

  it('stats 拒绝非法日期格式', () => {
    const service = new ProcessingFlowService(db);
    expect(() => service.stats({ from: '2026-8-5' }, context)).toThrow('起始 日期格式必须为 YYYY-MM-DD');
    expect(() => service.stats({ to: '2026/08/05' }, context)).toThrow('结束 日期格式必须为 YYYY-MM-DD');
  });

  it('registerStep CAS 为 0 时抛 Conflict', () => {
    insertOrder('po-flow-cas', 'PF-CAS');
    new ProcessingFlowService(db).ensureSteps('po-flow-cas', context);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes("SET status = 'DONE'")) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    expect(() => new ProcessingFlowService(db).registerStep('po-flow-cas', {}, context)).toThrow(ConflictError);
  });

  it('setStep CAS 为 0 时抛 NotFound', () => {
    insertOrder('po-flow-set-cas', 'PF-SETCAS');
    new ProcessingFlowService(db).ensureSteps('po-flow-set-cas', context);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE ProcessingOrderStep SET status = ?') && sql.includes('operatorId')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    expect(() => new ProcessingFlowService(db).setStep('po-flow-set-cas', { stepId: 'step-model', status: 'DONE' }, context))
      .toThrow(NotFoundError);
  });

  it('setStep 更新后列表缺失该行时返回旧步骤对象', () => {
    insertOrder('po-flow-stale-row', 'PF-STALEROW');
    new ProcessingFlowService(db).ensureSteps('po-flow-stale-row', context);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      // 仅拦截 setStep 末尾的列表查询（无 LIMIT）；步骤查找带 LIMIT 1 走真实路径
      if (sql.includes('id, stepId, stepName, status, sortOrder') && !sql.includes('LIMIT 1')) {
        return { all: () => [] } as never;
      }
      return originalPrepare(sql);
    });
    const result = new ProcessingFlowService(db).setStep('po-flow-stale-row', { stepId: 'step-model', status: 'IN_PROGRESS' }, context);
    // 列表缺失时回退到更新前的旧快照（status 仍为 PENDING）
    expect(result).toMatchObject({ stepId: 'step-model', status: 'PENDING' });
  });
});
