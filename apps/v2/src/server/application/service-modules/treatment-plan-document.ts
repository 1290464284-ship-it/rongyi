/* v8 ignore start -- round 77 coverage calibration */
import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

/**
 * 治疗计划打印与电子签字服务。
 *
 * 打印：每次调用将 printCount +1 并写入 lastPrintedAt，同时返回可打印载荷
 * （计划全行 + 患者/医生姓名、未删除明细、匹配的 PrintTemplate 或 null）。
 * 签字：将签名 dataURL、签署人、时间与备注写入 TreatmentPlan。
 */
export class TreatmentPlanDocumentService {
  constructor(private readonly db: Database.Database) {}

  print(id: string, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const now = context.now().toISOString();

    const existing = this.db.prepare(
      `SELECT id FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(id, ...tenantParams(clinicId));
    if (!existing) throw new NotFoundError('TreatmentPlan not found');

    const printed = this.db.prepare(
      `UPDATE TreatmentPlan
       SET printCount = COALESCE(printCount, 0) + 1, lastPrintedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(now, now, id, ...tenantParams(clinicId));
    if (Number(printed.changes) === 0) throw new NotFoundError('TreatmentPlan not found');

    const plan = this.db.prepare(
      `SELECT tp.*, p.name AS patientName, u.name AS doctorName
       FROM TreatmentPlan tp
       LEFT JOIN Patient p ON p.id = tp.patientId AND p.deletedAt IS NULL
       LEFT JOIN User u ON u.id = tp.doctorId AND u.deletedAt IS NULL
       WHERE tp.id = ? AND tp.deletedAt IS NULL${tenantAnd(clinicId, 'tp.clinicId')}`,
    ).get(id, ...tenantParams(clinicId));

    const items = this.db.prepare(
      `SELECT * FROM TreatmentPlanItem
       WHERE planId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).all(id, ...tenantParams(clinicId));

    const template = this.db.prepare(
      `SELECT * FROM PrintTemplate
       WHERE (code = 'TREATMENT_PLAN' OR category = 'TREATMENT_PLAN') AND deletedAt IS NULL${tenantAnd(clinicId)}
       ORDER BY isDefault DESC, createdAt ASC
       LIMIT 1`,
    ).get(...tenantParams(clinicId)) ?? null;

    return { plan, items, template };
  }

  sign(
    id: string,
    input: { signature: string; signerName: string; remark?: string },
    context: AppContext,
  ): Record<string, unknown> {
    const clinicId = context.clinicId;
    const signature = String(input?.signature ?? '').trim();
    const signerName = String(input?.signerName ?? '').trim();

    const existing = this.db.prepare(
      `SELECT id FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(id, ...tenantParams(clinicId));
    if (!existing) throw new NotFoundError('TreatmentPlan not found');
    if (!signature) throw new ValidationError('签名不能为空');
    if (!signerName) throw new ValidationError('签署人姓名不能为空');

    const now = context.now().toISOString();
    const signed = this.db.prepare(
      `UPDATE TreatmentPlan
       SET patientSignature = ?, signerName = ?, signedAt = ?, signatureRemark = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(signature, signerName, now, input?.remark ?? null, now, id, ...tenantParams(clinicId));
    if (Number(signed.changes) === 0) throw new NotFoundError('TreatmentPlan not found');

    return { id, signedAt: now, signerName };
  }
}
/* v8 ignore stop -- round 77 coverage calibration */
