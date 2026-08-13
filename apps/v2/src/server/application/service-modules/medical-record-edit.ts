import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

/** 合并时允许直写的 TEXT 字段（白名单，防止 SQL 注入与任意列覆盖）。 */
const TEXT_FIELDS = [
  'category',
  'status',
  'chiefComplaint',
  'presentIllness',
  'pastHistory',
  'allergyHistory',
  'examination',
  'diagnosis',
  'treatmentPlan',
  'signature',
] as const;

/** 合并时要求为数组、以 JSON 字符串写入的字段。 */
const JSON_ARRAY_FIELDS = ['teethInvolved', 'images'] as const;

const ALLOWED_FIELDS: readonly string[] = [...TEXT_FIELDS, ...JSON_ARRAY_FIELDS];

/**
 * 病历修改申请与审核。
 *
 * 医生对（已锁定的）病历发起修改申请并附修改后内容；上级审核通过后
 * 合并白名单字段并解锁（isLocked=0），驳回则仅留痕（REJECTED）不合并、不解锁。
 */
export class MedicalRecordEditService {
  constructor(private readonly db: Database.Database) {}

  requestEdit(
    id: string,
    input: { reason: string; proposedContent: Record<string, unknown> },
    context: AppContext,
  ): Record<string, unknown> {
    const row = this.getRecord(id, context.clinicId);
    const status = String(row.editRequestStatus ?? 'NONE');
    if (status !== 'NONE' && status !== 'REJECTED') {
      throw new ConflictError('该病历已有待审核的修改申请');
    }
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw new ValidationError('修改原因不能为空');
    const proposedContent = input.proposedContent;
    if (
      typeof proposedContent !== 'object' ||
      proposedContent === null ||
      Array.isArray(proposedContent) ||
      Object.keys(proposedContent).length === 0
    ) {
      throw new ValidationError('修改内容不能为空');
    }
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE MedicalRecord
       SET editRequestStatus = 'PENDING',
           editRequestReason = ?,
           editRequestedById = ?,
           editRequestedAt = ?,
           proposedContentJson = ?,
           updatedAt = ?
       WHERE id = ?
         AND (editRequestStatus IS NULL OR editRequestStatus IN ('NONE', 'REJECTED'))
         AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(reason, context.userId, now, JSON.stringify(proposedContent), now, id, ...tenantParams(context.clinicId));
    if (result.changes === 0) throw new ConflictError('该病历已有待审核的修改申请');
    return { id, editRequestStatus: 'PENDING' };
  }

  review(
    id: string,
    input: { approve: boolean; reviewNote?: string },
    context: AppContext,
  ): Record<string, unknown> {
    const row = this.getRecord(id, context.clinicId);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', '仅管理员可审核病历修改申请', 403);
    }
    if (context.userId === String(row.editRequestedById ?? '')) {
      throw new AppError('FORBIDDEN', '不能审核自己的修改申请', 403);
    }
    if (String(row.editRequestStatus ?? '') !== 'PENDING') {
      throw new ConflictError('该病历没有待审核的修改申请');
    }
    const approve = input.approve === true;
    const now = context.now().toISOString();
    const sets: string[] = [];
    const values: Array<string | number | null> = [];

    if (approve) {
      let proposedContent: Record<string, unknown>;
      try {
        const parsed = JSON.parse(String(row.proposedContentJson ?? '')) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('proposed content is not an object');
        }
        proposedContent = parsed as Record<string, unknown>;
      } catch {
        throw new ValidationError('修改内容格式无效');
      }
      // 只合并白名单内且 proposedContent 中实际存在的 key；key 经白名单校验后
      // 才拼进 SET（防 SQL 注入），值一律走 ? 参数绑定。
      for (const key of Object.keys(proposedContent)) {
        if (!ALLOWED_FIELDS.includes(key)) continue;
        const value = proposedContent[key];
        if ((JSON_ARRAY_FIELDS as readonly string[]).includes(key)) {
          if (!Array.isArray(value)) throw new ValidationError(`${key} 必须为数组`);
          sets.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          sets.push(`${key} = ?`);
          values.push(typeof value === 'string' ? value : value === null ? null : JSON.stringify(value));
        }
      }
      sets.push('isLocked = 0', 'lockedAt = NULL', 'lockedBy = NULL');
    }

    sets.push(
      'editRequestStatus = ?',
      'reviewedById = ?',
      'reviewedAt = ?',
      'reviewNote = ?',
      'updatedAt = ?',
    );
    values.push(
      approve ? 'APPROVED' : 'REJECTED',
      context.userId,
      now,
      typeof input.reviewNote === 'string' ? input.reviewNote : null,
      now,
    );
    const result = this.db.prepare(
      `UPDATE MedicalRecord SET ${sets.join(', ')}
       WHERE id = ? AND editRequestStatus = 'PENDING' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(...values, id, ...tenantParams(context.clinicId));
    if (result.changes === 0) throw new ConflictError('该病历没有待审核的修改申请');

    return { id, editRequestStatus: approve ? 'APPROVED' : 'REJECTED', applied: approve };
  }

  pending(context: AppContext): Array<Record<string, unknown>> {
    const rows = this.db.prepare(
      `SELECT * FROM MedicalRecord
       WHERE deletedAt IS NULL AND editRequestStatus = 'PENDING'${tenantAnd(context.clinicId)}`,
    ).all(...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const output = { ...row };
      try {
        const parsed = JSON.parse(String(row.proposedContentJson ?? '')) as unknown;
        output.proposedContent =
          typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
      } catch {
        output.proposedContent = null;
      }
      return output;
    });
  }

  private getRecord(id: string, clinicId: string | null): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT * FROM MedicalRecord WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(id, ...tenantParams(clinicId)) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('MedicalRecord not found');
    return row;
  }
}
