import { sanitizePlain } from '../../../../common/utils/security/sanitize';
import type { FieldError, RowValidationResult } from './patient.validator';

export interface DrugImportRow {
  code: string;
  name: string;
  spec?: string;
  category?: string;
  unit?: string;
  price?: number;
  stock?: number;
  remark?: string;
}

export function validateDrugRow(
  row: DrugImportRow,
  rowIndex: number,
  context?: { existingCodesInBatch?: Set<string> },
): RowValidationResult {
  const errors: FieldError[] = [];
  const batchCodes = context?.existingCodesInBatch ?? new Set<string>();

  if (!row.code || typeof row.code !== 'string') {
    errors.push({ field: 'code', code: 'REQUIRED', message: 'code 必填' });
  } else {
    if (batchCodes.has(row.code)) {
      errors.push({ field: 'code', code: 'DUPLICATE_CODE_IN_BATCH', message: '本次导入中 code 重复' });
    }
  }

  if (!row.name || typeof row.name !== 'string') {
    errors.push({ field: 'name', code: 'REQUIRED', message: 'name 必填' });
  } else {
    const trimmed = row.name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      errors.push({ field: 'name', code: 'INVALID_LENGTH', message: 'name 长度必须 1-100' });
    }
  }

  if (row.price != null) {
    if (typeof row.price !== 'number' || isNaN(row.price) || row.price < 0) {
      errors.push({ field: 'price', code: 'INVALID_VALUE', message: 'price 必须是 ≥0 的数字' });
    }
  }

  if (row.stock != null) {
    if (typeof row.stock !== 'number' || isNaN(row.stock) || row.stock < 0 || !Number.isSafeInteger(row.stock)) {
      errors.push({ field: 'stock', code: 'INVALID_VALUE', message: 'stock 必须是 ≥0 的整数' });
    }
  }

  return { rowIndex, errors };
}

export function normalizeDrugRow(row: DrugImportRow): DrugImportRow {
  const normalized: DrugImportRow = { ...row };
  if (normalized.name) normalized.name = sanitizePlain(normalized.name);
  if (normalized.spec) normalized.spec = sanitizePlain(normalized.spec);
  if (normalized.category) normalized.category = sanitizePlain(normalized.category);
  if (normalized.remark) normalized.remark = sanitizePlain(normalized.remark);
  return normalized;
}
