/**
 * 主记录 + 明细的原子保存：处方与治疗计划编辑一次请求内完成主表更新与明细 reconcile，
 * 避免前端“先改主表再同步明细”留下半套数据。明细读取/校验失败时整个事务回滚。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import { assertDoctorExists, assertPatientExists } from './common';
import type { AppContext } from '../../../domain/contracts';

const TREATMENT_PLAN_STATUSES = new Set(['PLANNED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const PRESCRIPTION_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSED', 'CANCELLED']);
const MAX_ITEM_QUANTITY = 1_000_000;
const MAX_ITEM_PRICE = 100_000_000_00;

export interface TreatmentPlanSaveItem {
  id?: string | null;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  status: string;
}

export interface TreatmentPlanSaveInput {
  patientId: string;
  doctorId: string;
  name: string;
  status: string;
  totalFee: number;
  remark?: string;
  items: TreatmentPlanSaveItem[];
}

export interface PrescriptionSaveItem {
  id?: string | null;
  name: string;
  specification?: string;
  dosage?: string;
  frequency?: string;
  days: number;
  quantity: number;
  price: number;
}

export interface PrescriptionSaveInput {
  patientId: string;
  doctorId: string;
  remark?: string;
  status: string;
  items: PrescriptionSaveItem[];
}

export class EditSaveService {
  constructor(private readonly db: Database.Database) {}

  saveTreatmentPlan(planId: string, input: TreatmentPlanSaveInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const row = this.db.prepare(
      `SELECT id FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(planId, ...tenantParams(clinicId)) as { id: string } | undefined;
    if (!row) throw new NotFoundError('治疗计划不存在');

    const name = String(input.name ?? '').trim();
    if (!name) throw new ValidationError('计划名称不能为空');
    if (!TREATMENT_PLAN_STATUSES.has(input.status)) throw new ValidationError('治疗计划状态无效');
    if (!Number.isSafeInteger(input.totalFee) || input.totalFee < 0) {
      throw new ValidationError('总费用必须为非负整数（分）');
    }
    if (typeof input.patientId !== 'string' || input.patientId.trim() === '') throw new ValidationError('患者必填');
    if (typeof input.doctorId !== 'string' || input.doctorId.trim() === '') throw new ValidationError('医生必填');
    assertPatientExists(this.db, input.patientId, clinicId);
    assertDoctorExists(this.db, input.doctorId, clinicId);
    if (!Array.isArray(input.items)) throw new ValidationError('明细格式无效');
    const items = input.items.map((item, index) => this.normalizePlanItem(item, index));
    if (items.length === 0) throw new ValidationError('治疗计划至少需要一条有效明细');

    const now = context.now().toISOString();
    this.db.transaction(() => {
      const main = this.db.prepare(
        `UPDATE TreatmentPlan
         SET patientId = ?, doctorId = ?, name = ?, status = ?, totalFee = ?, remark = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).run(input.patientId, input.doctorId, name, input.status, input.totalFee, input.remark ?? null, now, planId, ...tenantParams(clinicId));
      if (main.changes === 0) throw new NotFoundError('治疗计划不存在');
      trackResourceWrite(this.db, {
        tableName: 'TreatmentPlan',
        recordId: planId,
        operation: 'UPDATE',
        clinicId: clinicId ?? null,
      });

      const existingRows = this.db.prepare(
        `SELECT * FROM TreatmentPlanItem
         WHERE planId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).all(planId, ...tenantParams(clinicId)) as Array<Record<string, unknown>>;
      const existingById = new Map(existingRows.map((entry) => [String(entry.id), entry]));
      const keptIds = new Set<string>();
      const updateItem = this.db.prepare(
        `UPDATE TreatmentPlanItem
         SET code = ?, name = ?, category = ?, price = ?, quantity = ?, teethNumbers = ?, status = ?, updatedAt = ?
         WHERE id = ? AND planId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      );
      const insertItem = this.db.prepare(
        `INSERT INTO TreatmentPlanItem (
           id, clinicId, createdAt, updatedAt, deletedAt, planId,
           code, name, category, price, quantity, teethNumbers, status, billed
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const softDeleteItem = this.db.prepare(
        `UPDATE TreatmentPlanItem SET deletedAt = ?, updatedAt = ?
         WHERE id = ? AND planId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      );

      for (const item of items) {
        const existing = item.id ? existingById.get(item.id) : undefined;
        if (existing) {
          if (Number(existing.billed) === 1) {
            if (this.planItemMatches(existing, item)) {
              keptIds.add(item.id as string);
              continue;
            }
            throw new ConflictError('已划价明细不可修改');
          }
          const updated = updateItem.run(
            item.code, item.name, item.category, item.price, item.quantity,
            JSON.stringify(item.teethNumbers), item.status, now, item.id, planId, ...tenantParams(clinicId),
          );
          if (updated.changes === 0) throw new NotFoundError('治疗计划明细不存在');
          keptIds.add(item.id as string);
          trackResourceWrite(this.db, {
            tableName: 'TreatmentPlanItem',
            recordId: item.id as string,
            operation: 'UPDATE',
            clinicId: clinicId ?? null,
          });
        } else {
          const newId = item.id ?? randomUUID();
          insertItem.run(
            newId, clinicId ?? null, now, now, planId, item.code, item.name, item.category,
            item.price, item.quantity, JSON.stringify(item.teethNumbers), item.status,
          );
          keptIds.add(newId);
          trackResourceWrite(this.db, {
            tableName: 'TreatmentPlanItem',
            recordId: newId,
            operation: 'INSERT',
            clinicId: clinicId ?? null,
          });
        }
      }
      for (const existing of existingRows) {
        if (keptIds.has(String(existing.id))) continue;
        if (Number(existing.billed) === 1) throw new ConflictError('已划价明细不可删除');
        softDeleteItem.run(now, now, String(existing.id), planId, ...tenantParams(clinicId));
        trackResourceWrite(this.db, {
          tableName: 'TreatmentPlanItem',
          recordId: String(existing.id),
          operation: 'DELETE',
          clinicId: clinicId ?? null,
        });
      }
    })();
    return { id: planId, status: input.status, items: items.length };
  }

  savePrescription(prescriptionId: string, input: PrescriptionSaveInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const row = this.db.prepare(
      `SELECT id FROM Prescription WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(prescriptionId, ...tenantParams(clinicId)) as { id: string } | undefined;
    if (!row) throw new NotFoundError('处方不存在');

    if (!PRESCRIPTION_STATUSES.has(input.status)) throw new ValidationError('处方状态无效');
    if (typeof input.patientId !== 'string' || input.patientId.trim() === '') throw new ValidationError('患者必填');
    if (typeof input.doctorId !== 'string' || input.doctorId.trim() === '') throw new ValidationError('医生必填');
    assertPatientExists(this.db, input.patientId, clinicId);
    assertDoctorExists(this.db, input.doctorId, clinicId);
    if (!Array.isArray(input.items)) throw new ValidationError('明细格式无效');
    const items = input.items.map((item, index) => this.normalizePrescriptionItem(item, index));
    if (items.length === 0) throw new ValidationError('处方至少需要一条有效明细');

    const now = context.now().toISOString();
    this.db.transaction(() => {
      const main = this.db.prepare(
        `UPDATE Prescription
         SET patientId = ?, doctorId = ?, remark = ?, status = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).run(input.patientId, input.doctorId, input.remark ?? null, input.status, now, prescriptionId, ...tenantParams(clinicId));
      if (main.changes === 0) throw new NotFoundError('处方不存在');
      trackResourceWrite(this.db, {
        tableName: 'Prescription',
        recordId: prescriptionId,
        operation: 'UPDATE',
        clinicId: clinicId ?? null,
      });

      const existingRows = this.db.prepare(
        `SELECT * FROM PrescriptionItem
         WHERE prescriptionId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).all(prescriptionId, ...tenantParams(clinicId)) as Array<Record<string, unknown>>;
      const existingById = new Map(existingRows.map((entry) => [String(entry.id), entry]));
      const keptIds = new Set<string>();
      const updateItem = this.db.prepare(
        `UPDATE PrescriptionItem
         SET name = ?, specification = ?, dosage = ?, frequency = ?, days = ?, quantity = ?, price = ?, updatedAt = ?
         WHERE id = ? AND prescriptionId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      );
      const insertItem = this.db.prepare(
        `INSERT INTO PrescriptionItem (
           id, clinicId, createdAt, updatedAt, deletedAt, prescriptionId,
           name, specification, dosage, frequency, days, quantity, price
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const softDeleteItem = this.db.prepare(
        `UPDATE PrescriptionItem SET deletedAt = ?, updatedAt = ?
         WHERE id = ? AND prescriptionId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      );

      for (const item of items) {
        const existing = item.id ? existingById.get(item.id) : undefined;
        if (existing) {
          const updated = updateItem.run(
            item.name, item.specification ?? null, item.dosage ?? null, item.frequency ?? null,
            item.days, item.quantity, item.price, now, item.id, prescriptionId, ...tenantParams(clinicId),
          );
          if (updated.changes === 0) throw new NotFoundError('处方明细不存在');
          keptIds.add(item.id as string);
          trackResourceWrite(this.db, {
            tableName: 'PrescriptionItem',
            recordId: item.id as string,
            operation: 'UPDATE',
            clinicId: clinicId ?? null,
          });
        } else {
          const newId = item.id ?? randomUUID();
          insertItem.run(
            newId, clinicId ?? null, now, now, prescriptionId, item.name,
            item.specification ?? null, item.dosage ?? null, item.frequency ?? null,
            item.days, item.quantity, item.price,
          );
          keptIds.add(newId);
          trackResourceWrite(this.db, {
            tableName: 'PrescriptionItem',
            recordId: newId,
            operation: 'INSERT',
            clinicId: clinicId ?? null,
          });
        }
      }
      for (const existing of existingRows) {
        if (keptIds.has(String(existing.id))) continue;
        softDeleteItem.run(now, now, String(existing.id), prescriptionId, ...tenantParams(clinicId));
        trackResourceWrite(this.db, {
          tableName: 'PrescriptionItem',
          recordId: String(existing.id),
          operation: 'DELETE',
          clinicId: clinicId ?? null,
        });
      }
    })();
    return { id: prescriptionId, status: input.status, items: items.length };
  }

  private normalizePlanItem(item: TreatmentPlanSaveItem, index: number): TreatmentPlanSaveItem {
    const code = String(item.code ?? '').trim();
    const name = String(item.name ?? '').trim();
    const category = String(item.category ?? '').trim();
    const price = Number(item.price);
    const quantity = Number(item.quantity);
    const status = String(item.status ?? '').trim();
    if (!code || !name || !category) {
      throw new ValidationError(`第 ${index + 1} 条治疗计划明细缺少编码/名称/分类`);
    }
    if (!Number.isSafeInteger(price) || price <= 0 || price > MAX_ITEM_PRICE) {
      throw new ValidationError(`第 ${index + 1} 条治疗计划明细价格无效`);
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_ITEM_QUANTITY) {
      throw new ValidationError(`第 ${index + 1} 条治疗计划明细数量无效`);
    }
    if (!status) throw new ValidationError(`第 ${index + 1} 条治疗计划明细状态无效`);
    const teethNumbers = Array.isArray(item.teethNumbers) ? item.teethNumbers.map(String) : [];
    return {
      id: item.id === undefined || item.id === null || item.id === '' ? undefined : String(item.id),
      code, name, category, price, quantity, teethNumbers, status,
    };
  }

  private planItemMatches(existing: Record<string, unknown>, item: TreatmentPlanSaveItem): boolean {
    const existingTeeth = Array.isArray(existing.teethNumbers)
      ? existing.teethNumbers.map(String)
      : this.parseTeeth(existing.teethNumbers);
    return (
      String(existing.code ?? '') === item.code &&
      String(existing.name ?? '') === item.name &&
      String(existing.category ?? '') === item.category &&
      Number(existing.price ?? 0) === item.price &&
      Number(existing.quantity ?? 0) === item.quantity &&
      JSON.stringify(existingTeeth) === JSON.stringify(item.teethNumbers) &&
      String(existing.status ?? '') === item.status
    );
  }

  private parseTeeth(value: unknown): string[] {
    try {
      const parsed = JSON.parse(String(value ?? '[]')) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private normalizePrescriptionItem(item: PrescriptionSaveItem, index: number): PrescriptionSaveItem {
    const name = String(item.name ?? '').trim();
    const days = Number(item.days);
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    if (!name) throw new ValidationError(`第 ${index + 1} 条处方明细缺少名称`);
    if (!Number.isSafeInteger(days) || days <= 0 || days > MAX_ITEM_QUANTITY) {
      throw new ValidationError(`第 ${index + 1} 条处方明细天数无效`);
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_ITEM_QUANTITY) {
      throw new ValidationError(`第 ${index + 1} 条处方明细数量无效`);
    }
    if (!Number.isSafeInteger(price) || price < 0 || price > MAX_ITEM_PRICE) {
      throw new ValidationError(`第 ${index + 1} 条处方明细单价无效`);
    }
    return {
      id: item.id === undefined || item.id === null || item.id === '' ? undefined : String(item.id),
      name,
      specification: item.specification === undefined || item.specification === null ? undefined : String(item.specification),
      dosage: item.dosage === undefined || item.dosage === null ? undefined : String(item.dosage),
      frequency: item.frequency === undefined || item.frequency === null ? undefined : String(item.frequency),
      days, quantity, price,
    };
  }
}
