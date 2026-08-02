/* eslint-disable @typescript-eslint/no-unused-vars, sonarjs/no-unused-collection -- TODO: 逐步修复 lint 问题 */
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AppLogger } from '../../../common/services/logger.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';
import { sanitizePlain } from '../../../common/utils/security/sanitize';
import { BusinessValidationException, BusinessForbiddenException } from '../../../common/errors';
import { Gender, PatientSource } from '@dental/shared';

import {
  PatientImportRow,
  FieldError,
  RowValidationResult,
  validatePatientRow,
  normalizePatientRow,
} from './validators/patient.validator';
import {
  DrugImportRow,
  validateDrugRow,
  normalizeDrugRow,
} from './validators/drug.validator';
import {
  InventoryImportRow,
  validateInventoryRow,
  normalizeInventoryRow,
} from './validators/inventory.validator';

export interface ColumnDef {
  key: string;
  required: boolean;
  type: 'string' | 'number' | 'enum' | 'array';
  example: unknown;
  description?: string;
  enumValues?: string[];
}

export interface BulkImportSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface BulkImportResult {
  summary: BulkImportSummary;
  rowErrors: RowValidationResult[];
  createdIds: string[];
}

const BATCH_SIZE = 50;

@Injectable()
export class BulkImportService {
  private logger = new AppLogger(BulkImportService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
    private auditLogService: AuditLogService,
  ) {}

  private async checkFeatureEnabled(): Promise<void> {
    const enabled = await this.settingsService.getBoolean('aiBulkImportEnabled', true);
    if (!enabled) {
      throw new BusinessForbiddenException('批量导入已停用');
    }
  }

  private async checkMaxRows(rows: unknown[]): Promise<void> {
    const maxRows = await this.settingsService.getNumber('aiBulkImportMaxRows', 500);
    if (rows.length > maxRows) {
      throw new BusinessValidationException(`单次最大导入 ${maxRows} 行`);
    }
  }

  private patientCodeCounter = 0;

  private generateCode(prefix: string): string {
    this.patientCodeCounter++;
    const ts = Date.now().toString().slice(-5);
    return `${prefix}${ts}${this.patientCodeCounter.toString().padStart(3, '0')}`;
  }

  getImportTemplate(type: 'patient' | 'drug' | 'inventory'): { columns: ColumnDef[]; sampleRow: object } {
    if (type === 'patient') {
      const columns: ColumnDef[] = [
        { key: 'code', required: false, type: 'string', example: 'P10001', description: '患者编号（缺则自动生成）' },
        { key: 'name', required: true, type: 'string', example: '张三', description: '姓名 1-50 字符' },
        { key: 'gender', required: true, type: 'enum', example: 'MALE', enumValues: Object.values(Gender), description: '性别' },
        { key: 'phone', required: true, type: 'string', example: '13800138000', description: '11 位手机号' },
        { key: 'birthDate', required: false, type: 'string', example: '1990-01-15', description: '出生日期 YYYY-MM-DD' },
        { key: 'source', required: false, type: 'enum', example: 'WALK_IN', enumValues: Object.values(PatientSource), description: '来源（默认 WALK_IN）' },
        { key: 'address', required: false, type: 'string', example: '北京市朝阳区某街道 100 号', description: '地址 ≤200 字符' },
        { key: 'occupation', required: false, type: 'string', example: '工程师' },
        { key: 'tags', required: false, type: 'array', example: ['VIP', '复诊'] },
        { key: 'allergies', required: false, type: 'array', example: ['青霉素'] },
        { key: 'systemicDiseases', required: false, type: 'array', example: ['高血压'] },
        { key: 'remark', required: false, type: 'string', example: '备注信息' },
      ];
      const sampleRow: PatientImportRow = {
        code: 'P10001',
        name: '张三',
        gender: Gender.MALE,
        phone: '13800138000',
        birthDate: '1990-01-15',
        source: PatientSource.WALK_IN,
        address: '北京市朝阳区某街道 100 号',
        occupation: '工程师',
        tags: ['VIP'],
        allergies: ['青霉素'],
        systemicDiseases: [],
        remark: '初诊患者',
      };
      return { columns, sampleRow };
    }

    if (type === 'drug') {
      const columns: ColumnDef[] = [
        { key: 'code', required: true, type: 'string', example: 'DRG001', description: '药品 SKU/编码（clinicId 维度唯一）' },
        { key: 'name', required: true, type: 'string', example: '阿莫西林胶囊', description: '名称 1-100 字符' },
        { key: 'spec', required: false, type: 'string', example: '0.5g*24 片' },
        { key: 'category', required: false, type: 'string', example: '抗生素' },
        { key: 'unit', required: false, type: 'string', example: '盒' },
        { key: 'price', required: false, type: 'number', example: 28.5, description: '元，≥0' },
        { key: 'stock', required: false, type: 'number', example: 100, description: '整数 ≥0，同步初始化库存' },
        { key: 'remark', required: false, type: 'string', example: '处方用药' },
      ];
      const sampleRow: DrugImportRow = {
        code: 'DRG001',
        name: '阿莫西林胶囊',
        spec: '0.5g*24 片',
        category: '抗生素',
        unit: '盒',
        price: 28.5,
        stock: 100,
        remark: '处方用药',
      };
      return { columns, sampleRow };
    }

    const columns: ColumnDef[] = [
      { key: 'sku', required: true, type: 'string', example: 'DRG001', description: '对应 DrugCatalog.code' },
      { key: 'name', required: false, type: 'string', example: '阿莫西林胶囊', description: 'mode=autoCreateDrug 时必填' },
      { key: 'spec', required: false, type: 'string', example: '0.5g*24 片' },
      { key: 'stock', required: true, type: 'number', example: 50, description: '整数 ≥0，累加入库' },
      { key: 'unit', required: false, type: 'string', example: '盒' },
      { key: 'costPriceCents', required: false, type: 'number', example: 1850, description: '成本（分）' },
      { key: 'supplierName', required: false, type: 'string', example: '某医药供应商' },
      { key: 'minStock', required: false, type: 'number', example: 5, description: '安全库存下限，默认 5' },
      { key: 'maxStock', required: false, type: 'number', example: 100, description: '安全库存上限，默认 100' },
      { key: 'expiryDate', required: false, type: 'string', example: '2027-12-31', description: 'YYYY-MM-DD' },
      { key: 'batchNo', required: false, type: 'string', example: 'B20250101' },
      { key: 'remark', required: false, type: 'string', example: '入库批次' },
      { key: 'mode', required: false, type: 'enum', example: 'strict', enumValues: ['strict', 'autoCreateDrug'], description: 'strict：缺失报错；autoCreateDrug：自动建 DrugCatalog' },
    ];
    const sampleRow: InventoryImportRow = {
      sku: 'DRG001',
      name: '阿莫西林胶囊',
      spec: '0.5g*24 片',
      stock: 50,
      unit: '盒',
      costPriceCents: 1850,
      supplierName: '某医药供应商',
      minStock: 5,
      maxStock: 100,
      expiryDate: '2027-12-31',
      batchNo: 'B20250101',
      remark: '入库批次',
      mode: 'strict',
    };
    return { columns, sampleRow };
  }

  private getExistingPatientPhones(clinicId: string | null): Set<string> {
    const { clause, params } = buildClinicFilter(clinicId);
    const rows = this.dbService.prepare(
      `SELECT phone FROM Patient WHERE 1=1${clause} AND deletedAt IS NULL`,
    ).all(...params) as { phone: string }[];
    return new Set(rows.map((r) => r.phone));
  }

  private getExistingDrugCodes(clinicId: string | null): Set<string> {
    const { clause, params } = buildClinicFilter(clinicId);
    const rows = this.dbService.prepare(
      `SELECT code FROM DrugCatalog WHERE 1=1${clause}`,
    ).all(...params) as { code: string }[];
    return new Set(rows.map((r) => r.code));
  }

  private getExistingInventoryCodes(clinicId: string | null): Map<string, { id: string; stock: number }> {
    const { clause, params } = buildClinicFilter(clinicId);
    const rows = this.dbService.prepare(
      `SELECT id, code, stock FROM InventoryItem WHERE 1=1${clause} AND deletedAt IS NULL`,
    ).all(...params) as { id: string; code: string; stock: number }[];
    const map = new Map<string, { id: string; stock: number }>();
    for (const r of rows) {
      map.set(r.code, { id: r.id, stock: Number(r.stock) || 0 });
    }
    return map;
  }

  async importPatients(
    rows: PatientImportRow[],
    opts: { dryRun?: boolean; createdById?: string } = {},
  ): Promise<BulkImportResult> {
    await this.checkFeatureEnabled();
    const startTime = Date.now();
    const clinicId = this.clinicContext.getClinicId();

    if (!rows || rows.length === 0) {
      return {
        summary: { total: 0, success: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime },
        rowErrors: [],
        createdIds: [],
      };
    }

    await this.checkMaxRows(rows);

    const dbPhones = this.getExistingPatientPhones(clinicId);
    const firstPhoneOccurrence = new Map<string, number>();
    const phoneBatchDuplicateRows = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i]?.phone;
      if (typeof p === 'string' && p) {
        if (firstPhoneOccurrence.has(p)) {
          phoneBatchDuplicateRows.add(i);
        } else {
          firstPhoneOccurrence.set(p, i);
        }
      }
    }
    const batchPhones = new Set<string>();
    const rowErrors: RowValidationResult[] = [];
    const createdIds: string[] = [];
    const validRows: Array<{ row: PatientImportRow; index: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const phoneForBatchCheck = new Set<string>();
      if (phoneBatchDuplicateRows.has(i) && typeof raw.phone === 'string' && raw.phone) {
        phoneForBatchCheck.add(raw.phone);
      }
      const v = validatePatientRow(raw, i, { existingPhonesInBatch: phoneForBatchCheck, existingPhonesInDb: dbPhones });
      if (v.errors.length > 0) {
        rowErrors.push(v);
        continue;
      }
      const normalized = normalizePatientRow(raw);
      validRows.push({ row: normalized, index: i });
      if (normalized.phone) batchPhones.add(normalized.phone);
    }

    if (opts.dryRun) {
      return {
        summary: {
          total: rows.length,
          success: validRows.length,
          failed: rowErrors.length,
          skipped: rows.length - validRows.length - rowErrors.length,
          durationMs: Date.now() - startTime,
        },
        rowErrors,
        createdIds: [],
      };
    }

    for (let offset = 0; offset < validRows.length; offset += BATCH_SIZE) {
      const batch = validRows.slice(offset, offset + BATCH_SIZE);
      try {
        this.dbService.transaction((db) => {
          const now = new Date().toISOString();
          for (const { row } of batch) {
            try {
              const id = crypto.randomUUID();
              const code = row.code || this.generateCode('P');
              db.prepare(
                `INSERT INTO Patient (
                  id, code, name, gender, birthDate, phone, address, occupation, remark,
                  source, tags, allergies, systemicDiseases, medicalHistory, medicationHistory,
                  clinicId, active, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).run(
                id,
                code,
                sanitizePlain(row.name),
                row.gender,
                row.birthDate || null,
                row.phone,
                sanitizePlain(row.address || ''),
                sanitizePlain(row.occupation || ''),
                sanitizePlain(row.remark || ''),
                row.source,
                JSON.stringify(row.tags || []),
                JSON.stringify(row.allergies || []),
                JSON.stringify(row.systemicDiseases || []),
                JSON.stringify([]),
                JSON.stringify([]),
                clinicId,
                1,
                now,
                now,
              );
              createdIds.push(id);
            } catch (e: unknown) {
              this.logger.warn(`importPatients row failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        });
      } catch (e: unknown) {
        this.logger.warn(`importPatients batch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const durationMs = Date.now() - startTime;
    if (!opts.dryRun) {
      this.auditLogService.logAudit(this.dbService, AuditLogType.BULK_IMPORT_PATIENTS, '', 'Patient', clinicId, {
        afterData: {
          successCount: createdIds.length,
          failedCount: rowErrors.length,
          skippedCount: rows.length - createdIds.length - rowErrors.length,
          dryRun: false,
          durationMs,
        },
        operatorId: opts.createdById,
      });
    }

    return {
      summary: {
        total: rows.length,
        success: createdIds.length,
        failed: rowErrors.length,
        skipped: rows.length - createdIds.length - rowErrors.length,
        durationMs,
      },
      rowErrors,
      createdIds,
    };
  }

  async importDrugCatalog(
    rows: DrugImportRow[],
    opts: { dryRun?: boolean; createdById?: string } = {},
  ): Promise<BulkImportResult> {
    await this.checkFeatureEnabled();
    const startTime = Date.now();
    const clinicId = this.clinicContext.getClinicId();

    if (!rows || rows.length === 0) {
      return {
        summary: { total: 0, success: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime },
        rowErrors: [],
        createdIds: [],
      };
    }

    await this.checkMaxRows(rows);

    const batchCodes = new Set<string>();
    const rowErrors: RowValidationResult[] = [];
    const createdIds: string[] = [];
    const validRows: Array<{ row: DrugImportRow; index: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const v = validateDrugRow(raw, i, { existingCodesInBatch: batchCodes });
      if (v.errors.length > 0) {
        rowErrors.push(v);
        continue;
      }
      const normalized = normalizeDrugRow(raw);
      validRows.push({ row: normalized, index: i });
      if (normalized.code) batchCodes.add(normalized.code);
    }

    if (opts.dryRun) {
      return {
        summary: {
          total: rows.length,
          success: validRows.length,
          failed: rowErrors.length,
          skipped: rows.length - validRows.length - rowErrors.length,
          durationMs: Date.now() - startTime,
        },
        rowErrors,
        createdIds: [],
      };
    }

    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);

    for (let offset = 0; offset < validRows.length; offset += BATCH_SIZE) {
      const batch = validRows.slice(offset, offset + BATCH_SIZE);
      try {
        this.dbService.transaction((db) => {
          const now = new Date().toISOString();
          for (const { row } of batch) {
            try {
              const existing = db.prepare(
                `SELECT id, code FROM DrugCatalog WHERE code = ?${clinicClause}`,
              ).get(row.code, ...clinicParams) as { id: string; code: string } | undefined;

              if (existing) {
                db.prepare(
                  `UPDATE DrugCatalog SET name = ?, spec = ?, category = ?, unit = ?, price = ?, remark = ? WHERE id = ?`,
                ).run(
                  row.name || '',
                  row.spec || '',
                  row.category || '',
                  row.unit || '',
                  row.price ?? 0,
                  row.remark || '',
                  existing.id,
                );
                createdIds.push(existing.id);
              } else {
                const id = crypto.randomUUID();
                db.prepare(
                  `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                  id,
                  row.code,
                  row.name || '',
                  row.spec || '',
                  row.category || '',
                  row.unit || '',
                  row.price ?? 0,
                  0,
                  row.remark || '',
                  clinicId,
                  now,
                );
                createdIds.push(id);
              }

              if (row.stock !== undefined && row.stock > 0) {
                const invExisting = db.prepare(
                  `SELECT id, stock FROM InventoryItem WHERE code = ?${clinicClause}`,
                ).get(row.code, ...clinicParams) as { id: string; stock: number } | undefined;

                if (invExisting) {
                  const newStock = (Number(invExisting.stock) || 0) + row.stock;
                  db.prepare(
                    `UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ?`,
                  ).run(newStock, now, invExisting.id);
                } else {
                  const invId = crypto.randomUUID();
                  db.prepare(
                    `INSERT INTO InventoryItem (id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  ).run(
                    invId,
                    row.code,
                    row.name || '',
                    row.spec || '',
                    row.category || '',
                    row.unit || '',
                    row.stock,
                    0,
                    (row.price ?? 0) * 100,
                    null,
                    null,
                    '',
                    row.remark || '',
                    clinicId,
                    now,
                    now,
                  );
                }

                db.prepare(
                  `UPDATE DrugCatalog SET stock = stock + ? WHERE code = ?${clinicClause}`,
                ).run(row.stock, row.code, ...clinicParams);
              }
            } catch (e: unknown) {
              this.logger.warn(`importDrugCatalog row failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        });
      } catch (e: unknown) {
        this.logger.warn(`importDrugCatalog batch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const durationMs = Date.now() - startTime;
    if (!opts.dryRun) {
      this.auditLogService.logAudit(this.dbService, AuditLogType.BULK_IMPORT_DRUG_CATALOG, '', 'DrugCatalog', clinicId, {
        afterData: {
          successCount: createdIds.length,
          failedCount: rowErrors.length,
          skippedCount: rows.length - createdIds.length - rowErrors.length,
          dryRun: false,
          durationMs,
        },
        operatorId: opts.createdById,
      });
    }

    return {
      summary: {
        total: rows.length,
        success: createdIds.length,
        failed: rowErrors.length,
        skipped: rows.length - createdIds.length - rowErrors.length,
        durationMs,
      },
      rowErrors,
      createdIds,
    };
  }

  async importInventory(
    rows: InventoryImportRow[],
    opts: { dryRun?: boolean; createdById?: string } = {},
  ): Promise<BulkImportResult> {
    await this.checkFeatureEnabled();
    const startTime = Date.now();
    const clinicId = this.clinicContext.getClinicId();

    if (!rows || rows.length === 0) {
      return {
        summary: { total: 0, success: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime },
        rowErrors: [],
        createdIds: [],
      };
    }

    await this.checkMaxRows(rows);

    const dbDrugCodes = this.getExistingDrugCodes(clinicId);
    const existingInventory = this.getExistingInventoryCodes(clinicId);
    const batchSkus = new Set<string>();
    const rowErrors: RowValidationResult[] = [];
    const createdIds: string[] = [];
    const validRows: Array<{ row: InventoryImportRow; index: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const v = validateInventoryRow(raw, i, { existingSkusInBatch: batchSkus, existingDrugCodesInDb: dbDrugCodes });
      if (v.errors.length > 0) {
        rowErrors.push(v);
        continue;
      }
      const normalized = normalizeInventoryRow(raw);
      validRows.push({ row: normalized, index: i });
      if (normalized.sku) batchSkus.add(normalized.sku);
    }

    if (opts.dryRun) {
      return {
        summary: {
          total: rows.length,
          success: validRows.length,
          failed: rowErrors.length,
          skipped: rows.length - validRows.length - rowErrors.length,
          durationMs: Date.now() - startTime,
        },
        rowErrors,
        createdIds: [],
      };
    }

    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);

    for (let offset = 0; offset < validRows.length; offset += BATCH_SIZE) {
      const batch = validRows.slice(offset, offset + BATCH_SIZE);
      try {
        this.dbService.transaction((db) => {
          const now = new Date().toISOString();
          for (const { row } of batch) {
            try {
              if (row.mode === 'autoCreateDrug' && !dbDrugCodes.has(row.sku)) {
                const drugId = crypto.randomUUID();
                db.prepare(
                  `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                  drugId,
                  row.sku,
                  row.name || '',
                  row.spec || '',
                  '',
                  row.unit || '',
                  0,
                  0,
                  '',
                  clinicId,
                  now,
                );
                dbDrugCodes.add(row.sku);
              }

              const invExisting = existingInventory.get(row.sku);
              if (invExisting) {
                const newStock = invExisting.stock + row.stock;
                db.prepare(
                  `UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ?`,
                ).run(newStock, now, invExisting.id);
                createdIds.push(invExisting.id);
              } else {
                const invId = crypto.randomUUID();
                db.prepare(
                  `INSERT INTO InventoryItem (id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                  invId,
                  row.sku,
                  row.name || '',
                  row.spec || '',
                  '',
                  row.unit || '',
                  row.stock,
                  row.minStock ?? 5,
                  row.costPriceCents ?? 0,
                  null,
                  row.expiryDate || null,
                  row.supplierName || '',
                  row.remark || '',
                  clinicId,
                  now,
                  now,
                );
                createdIds.push(invId);
                existingInventory.set(row.sku, { id: invId, stock: row.stock });
              }
            } catch (e: unknown) {
              this.logger.warn(`importInventory row failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        });
      } catch (e: unknown) {
        this.logger.warn(`importInventory batch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const durationMs = Date.now() - startTime;
    if (!opts.dryRun) {
      this.auditLogService.logAudit(this.dbService, AuditLogType.BULK_IMPORT_INVENTORY, '', 'InventoryItem', clinicId, {
        afterData: {
          successCount: createdIds.length,
          failedCount: rowErrors.length,
          skippedCount: rows.length - createdIds.length - rowErrors.length,
          dryRun: false,
          durationMs,
        },
        operatorId: opts.createdById,
      });
    }

    return {
      summary: {
        total: rows.length,
        success: createdIds.length,
        failed: rowErrors.length,
        skipped: rows.length - createdIds.length - rowErrors.length,
        durationMs,
      },
      rowErrors,
      createdIds,
    };
  }
}
