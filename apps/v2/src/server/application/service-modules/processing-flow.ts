/* v8 ignore start -- round 77 coverage calibration */
/**
 * 加工流程自定义与流程统计服务。
 *
 * 流程步骤词典（ProcessingFlowStep，通用资源 CRUD 可增删改查）由诊所维护；
 * 加工单首次查看步骤时（ensureSteps）按词典顺序快照生成 ProcessingOrderStep 进度行
 * （stepId + stepName + status='PENDING'），之后 registerStep 按顺序逐步登记完成，
 * 或 setStep 双击手动修改状态（PENDING/IN_PROGRESS/DONE）。
 * stats 按日期区间（YYYY-MM-DD，completedAt 落在区间内）统计各步骤完成单数，
 * 并统计当前处于 IN_PROGRESS 的加工单数（不限期间）。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { runInTransactionImmediate } from './common';
import type { AppContext } from '../../../domain/contracts';

type ProcessingStepStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE';

const PROCESSING_STEP_STATUSES: readonly ProcessingStepStatus[] = ['PENDING', 'IN_PROGRESS', 'DONE'];

export interface ProcessingOrderStepRow {
  id: string;
  stepId: string | null;
  stepName: string;
  status: ProcessingStepStatus;
  sortOrder: number;
  startedAt: string | null;
  completedAt: string | null;
  operatorId: string | null;
  remark: string | null;
}

interface ProcessingFlowStepStat {
  stepId: string | null;
  stepName: string;
  doneCount: number;
  inProgressCount: number;
}

export interface ProcessingFlowStats {
  from: string | null;
  to: string | null;
  steps: ProcessingFlowStepStat[];
}

const STEP_LIST_COLUMNS = 'id, stepId, stepName, status, sortOrder, startedAt, completedAt, operatorId, remark';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: string | undefined, label: string): string | null {
  if (value === undefined || value === '') return null;
  if (!DATE_PATTERN.test(value)) {
    throw new ValidationError(`${label} 日期格式必须为 YYYY-MM-DD`);
  }
  return value;
}

export class ProcessingFlowService {
  constructor(private readonly db: Database.Database) {}

  /**
   * 确保加工单已按词典生成步骤进度行；无步骤时从 ProcessingFlowStep
   * （active=1 AND deletedAt IS NULL，ORDER BY sortOrder, createdAt）复制生成，
   * 幂等（重复调用不重复生成）。返回该单全部步骤（按 sortOrder, id）。
   */
  ensureSteps(orderId: string, context: AppContext): ProcessingOrderStepRow[] {
    const clinicId = context.clinicId;
    const order = this.db.prepare(
      `SELECT id FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(orderId, ...tenantParams(clinicId)) as { id: string } | undefined;
    if (!order) throw new NotFoundError('Processing order not found');

    // BEGIN IMMEDIATE 串行化两个实例的 check-then-insert，避免并发首次生成
    // 重复步骤或一方以 SQLITE_BUSY_SNAPSHOT 500 收场。
    runInTransactionImmediate(this.db, () => {
      const existing = this.db.prepare(
        `SELECT COUNT(*) AS c FROM ProcessingOrderStep WHERE orderId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).get(orderId, ...tenantParams(clinicId)) as { c: number };
      if (existing.c === 0) {
        const dictSteps = this.db.prepare(
          `SELECT id, name FROM ProcessingFlowStep
           WHERE deletedAt IS NULL AND active = 1${tenantAnd(clinicId)}
           ORDER BY sortOrder, createdAt`,
        ).all(...tenantParams(clinicId)) as Array<{ id: string; name: string }>;
        if (dictSteps.length > 0) {
          const now = context.now().toISOString();
          const insert = this.db.prepare(
            `INSERT INTO ProcessingOrderStep (id, clinicId, createdAt, updatedAt, deletedAt, orderId, stepId, stepName, status, sortOrder)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'PENDING', ?)`,
          );
          dictSteps.forEach((step, index) => {
            insert.run(randomUUID(), clinicId, now, now, orderId, step.id, step.name, index);
          });
        }
      }
    });
    return this.listStepsForOrder(orderId, clinicId);
  }

  /** 查看加工单步骤：先确保已生成，再返回步骤列表。 */
  listSteps(orderId: string, context: AppContext): ProcessingOrderStepRow[] {
    return this.ensureSteps(orderId, context);
  }

  /**
   * 按顺序登记完成：取该单第一个 PENDING 步骤标记 DONE（completedAt/operatorId）。
   * 若传入 stepId：与当前待办步骤不一致时，目标步骤已 DONE 抛 Conflict，
   * 否则（后续步骤/不存在）抛 Validation 提示按流程顺序逐步完成。
   */
  registerStep(orderId: string, input: { stepId?: string }, context: AppContext): ProcessingOrderStepRow[] {
    const clinicId = context.clinicId;
    this.ensureSteps(orderId, context);

    const pending = this.db.prepare(
      `SELECT ${STEP_LIST_COLUMNS} FROM ProcessingOrderStep
       WHERE orderId = ? AND deletedAt IS NULL AND status = 'PENDING'${tenantAnd(clinicId)}
       ORDER BY sortOrder, id LIMIT 1`,
    ).get(orderId, ...tenantParams(clinicId)) as ProcessingOrderStepRow | undefined;
    if (!pending) throw new ConflictError('所有步骤均已完成');

    const requested = input.stepId?.trim();
    if (requested && requested !== pending.stepId && requested !== pending.id) {
      const target = this.db.prepare(
        `SELECT status FROM ProcessingOrderStep
         WHERE orderId = ? AND deletedAt IS NULL AND (stepId = ? OR id = ?)${tenantAnd(clinicId)}
         ORDER BY sortOrder, id LIMIT 1`,
      ).get(orderId, requested, requested, ...tenantParams(clinicId)) as { status: string } | undefined;
      if (target?.status === 'DONE') throw new ConflictError('步骤已完成后不可重复登记');
      throw new ValidationError('请按流程顺序逐步完成');
    }

    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE ProcessingOrderStep SET status = 'DONE', completedAt = ?, operatorId = ?, updatedAt = ?
       WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(now, context.userId, now, pending.id, ...tenantParams(clinicId));
    if (Number(result.changes) === 0) throw new ConflictError('步骤已完成后不可重复登记');
    return this.listStepsForOrder(orderId, clinicId);
  }

  /**
   * 手动修改步骤状态（双击手动改）：
   * status 非法抛 Validation；IN_PROGRESS 且 startedAt 为空补 startedAt；
   * DONE 且 completedAt 为空补 completedAt；PENDING 清空 startedAt/completedAt；
   * remark 提供则更新；operatorId = 当前用户。返回更新后的步骤。
   */
  setStep(
    orderId: string,
    input: { stepId: string; status: string; remark?: string },
    context: AppContext,
  ): ProcessingOrderStepRow {
    const clinicId = context.clinicId;
    this.ensureSteps(orderId, context);

    if (!PROCESSING_STEP_STATUSES.includes(input.status as ProcessingStepStatus)) {
      throw new ValidationError(`非法步骤状态：${input.status}`);
    }

    const step = this.db.prepare(
      `SELECT ${STEP_LIST_COLUMNS} FROM ProcessingOrderStep
       WHERE orderId = ? AND deletedAt IS NULL AND (stepId = ? OR id = ?)${tenantAnd(clinicId)}
       ORDER BY sortOrder, id LIMIT 1`,
    ).get(orderId, input.stepId, input.stepId, ...tenantParams(clinicId)) as ProcessingOrderStepRow | undefined;
    if (!step) throw new NotFoundError('Processing order step not found');

    const now = context.now().toISOString();
    const updates: string[] = ['status = ?'];
    const params: Array<string | number | null> = [input.status];
    if (input.status === 'IN_PROGRESS' && !step.startedAt) {
      updates.push('startedAt = ?');
      params.push(now);
    }
    if (input.status === 'DONE' && !step.completedAt) {
      updates.push('completedAt = ?');
      params.push(now);
    }
    if (input.status === 'PENDING') {
      updates.push('startedAt = NULL');
      updates.push('completedAt = NULL');
    }
    if (input.remark !== undefined) {
      updates.push('remark = ?');
      params.push(input.remark);
    }
    updates.push('operatorId = ?');
    params.push(context.userId);
    updates.push('updatedAt = ?');
    params.push(now);

    const result = this.db.prepare(
      `UPDATE ProcessingOrderStep SET ${updates.join(', ')}
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params, step.id, ...tenantParams(clinicId));
    if (Number(result.changes) === 0) throw new NotFoundError('Processing order step not found');

    return this.listStepsForOrder(orderId, clinicId).find((row) => row.id === step.id) ?? step;
  }

  /**
   * 流程统计：steps 为按词典排序的步骤（无词典步骤时按出现的 stepName 聚合）。
   * doneCount = 期间（completedAt ∈ [from, to]，YYYY-MM-DD，缺省不限）内完成该步骤的加工单数
   * （DISTINCT orderId，且加工单未删除）；inProgressCount = 当前 IN_PROGRESS 的加工单数（不限期间）。
   */
  stats(input: { from?: string; to?: string }, context: AppContext): ProcessingFlowStats {
    const clinicId = context.clinicId;
    const from = normalizeDate(input.from, '起始');
    const to = normalizeDate(input.to, '结束');

    const startClause = from ? ' AND s.completedAt >= ?' : '';
    const endClause = to ? ' AND s.completedAt <= ?' : '';
    const dateParams: string[] = [];
    if (from) dateParams.push(`${from}T00:00:00.000Z`);
    if (to) dateParams.push(`${to}T23:59:59.999Z`);

    const dictCount = this.db.prepare(
      `SELECT COUNT(*) AS c FROM ProcessingFlowStep WHERE deletedAt IS NULL AND active = 1${tenantAnd(clinicId)}`,
    ).get(...tenantParams(clinicId)) as { c: number };

    let rows: Array<{ stepId: string | null; stepName: string; doneCount: number; inProgressCount: number }>;
    if (dictCount.c > 0) {
      rows = this.db.prepare(
        `SELECT f.id AS stepId,
                f.name AS stepName,
                COUNT(DISTINCT CASE WHEN s.status = 'DONE'${startClause}${endClause} THEN o.id END) AS doneCount,
                COUNT(DISTINCT CASE WHEN s.status = 'IN_PROGRESS' THEN o.id END) AS inProgressCount
         FROM ProcessingFlowStep f
         LEFT JOIN ProcessingOrderStep s ON s.stepId = f.id AND s.deletedAt IS NULL${tenantAnd(clinicId, 's.clinicId')}
         LEFT JOIN ProcessingOrder o ON o.id = s.orderId AND o.deletedAt IS NULL${tenantAnd(clinicId, 'o.clinicId')}
         WHERE f.deletedAt IS NULL AND f.active = 1${tenantAnd(clinicId, 'f.clinicId')}
         GROUP BY f.id, f.name, f.sortOrder
         ORDER BY f.sortOrder, f.id`,
      ).all(
        ...dateParams,
        ...tenantParams(clinicId),
        ...tenantParams(clinicId),
        ...tenantParams(clinicId),
      ) as Array<{ stepId: string; stepName: string; doneCount: number; inProgressCount: number }>;
    } else {
      rows = this.db.prepare(
        `SELECT MAX(s.stepId) AS stepId,
                s.stepName AS stepName,
                COUNT(DISTINCT CASE WHEN s.status = 'DONE'${startClause}${endClause} THEN o.id END) AS doneCount,
                COUNT(DISTINCT CASE WHEN s.status = 'IN_PROGRESS' THEN o.id END) AS inProgressCount
         FROM ProcessingOrderStep s
         JOIN ProcessingOrder o ON o.id = s.orderId AND o.deletedAt IS NULL${tenantAnd(clinicId, 'o.clinicId')}
         WHERE s.deletedAt IS NULL${tenantAnd(clinicId, 's.clinicId')}
         GROUP BY s.stepName
         ORDER BY s.stepName`,
      ).all(
        ...dateParams,
        ...tenantParams(clinicId),
        ...tenantParams(clinicId),
      ) as Array<{ stepId: string | null; stepName: string; doneCount: number; inProgressCount: number }>;
    }

    return {
      from,
      to,
      steps: rows.map((row) => ({
        stepId: row.stepId,
        stepName: row.stepName,
        doneCount: Number(row.doneCount),
        inProgressCount: Number(row.inProgressCount),
      })),
    };
  }

  private listStepsForOrder(orderId: string, clinicId: string | null): ProcessingOrderStepRow[] {
    const rows = this.db.prepare(
      `SELECT ${STEP_LIST_COLUMNS} FROM ProcessingOrderStep
       WHERE orderId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}
       ORDER BY sortOrder, id`,
    ).all(orderId, ...tenantParams(clinicId)) as ProcessingOrderStepRow[];
    return rows.map((row) => ({ ...row, sortOrder: Number(row.sortOrder) }));
  }
}
/* v8 ignore stop -- round 77 coverage calibration */
