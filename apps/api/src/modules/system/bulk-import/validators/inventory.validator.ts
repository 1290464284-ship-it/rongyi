import type { FieldError, RowValidationResult } from './patient.validator';
import { sanitizePlain } from '../../../../common/utils/security/sanitize';

export interface InventoryImportRow {
  sku: string;
  name?: string;
  spec?: string;
  stock: number;
  unit?: string;
  costPriceCents?: number;
  supplierName?: string;
  minStock?: number;
  maxStock?: number;
  expiryDate?: string;
  batchNo?: string;
  remark?: string;
  mode?: 'strict' | 'autoCreateDrug';
}

const EXPIRY_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateInventoryRow(
  row: InventoryImportRow,
  rowIndex: number,
  context?: { existingSkusInBatch?: Set<string>; existingDrugCodesInDb?: Set<string> },
): RowValidationResult {
  const errors: FieldError[] = [];
  const batchSkus = context?.existingSkusInBatch ?? new Set<string>();
  const dbDrugCodes = context?.existingDrugCodesInDb ?? new Set<string>();
  const mode = row.mode ?? 'strict';

  if (!row.sku || typeof row.sku !== 'string') {
    errors.push({ field: 'sku', code: 'REQUIRED', message: 'sku 必填' });
  } else {
    if (batchSkus.has(row.sku)) {
      errors.push({ field: 'sku', code: 'DUPLICATE_SKU_IN_BATCH', message: '本次导入中 sku 重复' });
    }
    if (mode === 'strict' && !dbDrugCodes.has(row.sku)) {
      errors.push({ field: 'sku', code: 'DRUG_NOT_FOUND', message: 'strict 模式下 DrugCatalog 中不存在该 sku，将跳过该行；如需自动创建请使用 mode=autoCreateDrug' });
    }
  }

  if (mode === 'autoCreateDrug' && (!row.name || typeof row.name !== 'string')) {
    errors.push({ field: 'name', code: 'REQUIRED', message: 'mode=autoCreateDrug 时 name 必填' });
  }

  if (row.stock == null) {
    errors.push({ field: 'stock', code: 'REQUIRED', message: 'stock 必填' });
  } else if (typeof row.stock !== 'number' || isNaN(row.stock) || row.stock < 0 || !Number.isSafeInteger(row.stock)) {
    errors.push({ field: 'stock', code: 'INVALID_VALUE', message: 'stock 必须是 ≥0 的整数' });
  }

  if (row.costPriceCents != null) {
    if (typeof row.costPriceCents !== 'number' || isNaN(row.costPriceCents) || !Number.isSafeInteger(row.costPriceCents)) {
      errors.push({ field: 'costPriceCents', code: 'INVALID_VALUE', message: 'costPriceCents 必须是整数' });
    }
  }

  if (row.minStock != null) {
    if (typeof row.minStock !== 'number' || isNaN(row.minStock) || row.minStock < 0) {
      errors.push({ field: 'minStock', code: 'INVALID_VALUE', message: 'minStock 必须是 ≥0 的数字' });
    }
  }

  if (row.maxStock != null) {
    const minStock = row.minStock ?? 5;
    if (typeof row.maxStock !== 'number' || isNaN(row.maxStock) || row.maxStock < 0) {
      errors.push({ field: 'maxStock', code: 'INVALID_VALUE', message: 'maxStock 必须是 ≥0 的数字' });
    } else if (row.maxStock < minStock) {
      errors.push({ field: 'maxStock', code: 'INVALID_VALUE', message: 'maxStock 不能小于 minStock' });
    }
  }

  if (row.expiryDate != null && row.expiryDate !== '') {
    if (!EXPIRY_DATE_REGEX.test(row.expiryDate)) {
      errors.push({ field: 'expiryDate', code: 'INVALID_FORMAT', message: 'expiryDate 格式必须是 YYYY-MM-DD' });
    }
  }

  return { rowIndex, errors };
}

export function normalizeInventoryRow(row: InventoryImportRow): InventoryImportRow {
  const normalized: InventoryImportRow = { ...row };
  if (normalized.minStock == null) normalized.minStock = 5;
  if (normalized.maxStock == null) normalized.maxStock = 100;
  if (!normalized.mode) normalized.mode = 'strict';
  if (normalized.name) normalized.name = sanitizePlain(normalized.name);
  if (normalized.spec) normalized.spec = sanitizePlain(normalized.spec);
  if (normalized.remark) normalized.remark = sanitizePlain(normalized.remark);
  return normalized;
}
