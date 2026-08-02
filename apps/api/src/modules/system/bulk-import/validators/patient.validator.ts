import { isPhoneNumber } from '@dental/shared';
import { Gender, PatientSource } from '@dental/shared';

export interface PatientImportRow {
  code?: string;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'UNKNOWN' | 'OTHER';
  phone: string;
  birthDate?: string;
  source?: string;
  address?: string;
  occupation?: string;
  tags?: string[];
  allergies?: string[];
  systemicDiseases?: string[];
  remark?: string;
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface RowValidationResult {
  rowIndex: number;
  errors: FieldError[];
}

const GENDER_VALUES = new Set(Object.values(Gender));
const SOURCE_VALUES = new Set(Object.values(PatientSource));
const BIRTH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validatePatientRow(
  row: PatientImportRow,
  rowIndex: number,
  context?: { existingPhonesInBatch?: Set<string>; existingPhonesInDb?: Set<string> },
): RowValidationResult {
  const errors: FieldError[] = [];
  const batchPhones = context?.existingPhonesInBatch ?? new Set<string>();
  const dbPhones = context?.existingPhonesInDb ?? new Set<string>();

  if (!row.name || typeof row.name !== 'string') {
    errors.push({ field: 'name', code: 'REQUIRED', message: 'name 必填' });
  } else {
    const trimmed = row.name.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      errors.push({ field: 'name', code: 'INVALID_LENGTH', message: 'name 长度必须 1-50' });
    }
  }

  if (!row.gender) {
    errors.push({ field: 'gender', code: 'REQUIRED', message: 'gender 必填' });
  } else if (!GENDER_VALUES.has(row.gender)) {
    errors.push({
      field: 'gender',
      code: 'INVALID_ENUM',
      message: `gender 必须是 ${Array.from(GENDER_VALUES).join('/')} 之一`,
    });
  }

  if (!row.phone || typeof row.phone !== 'string') {
    errors.push({ field: 'phone', code: 'REQUIRED', message: 'phone 必填' });
  } else if (!isPhoneNumber(row.phone)) {
    errors.push({ field: 'phone', code: 'INVALID_PHONE', message: 'phone 必须是 11 位合法手机号' });
  } else {
    if (batchPhones.has(row.phone)) {
      errors.push({
        field: 'phone',
        code: 'DUPLICATE_PHONE_IN_BATCH',
        message: '本次导入中 phone 重复',
      });
    }
    if (dbPhones.has(row.phone)) {
      errors.push({
        field: 'phone',
        code: 'DUPLICATE_PHONE_IN_DB',
        message: '数据库中已存在该 phone',
      });
    }
  }

  if (row.birthDate != null && row.birthDate !== '') {
    if (!BIRTH_DATE_REGEX.test(row.birthDate)) {
      errors.push({ field: 'birthDate', code: 'INVALID_FORMAT', message: 'birthDate 格式必须是 YYYY-MM-DD' });
    }
  }

  if (row.address != null && typeof row.address === 'string' && row.address.length > 200) {
    errors.push({ field: 'address', code: 'INVALID_LENGTH', message: 'address 长度不能超过 200' });
  }

  if (row.tags != null) {
    if (!Array.isArray(row.tags) || row.tags.some((t) => typeof t !== 'string')) {
      errors.push({ field: 'tags', code: 'INVALID_TYPE', message: 'tags 必须是字符串数组' });
    }
  }

  if (row.allergies != null) {
    if (!Array.isArray(row.allergies) || row.allergies.some((t) => typeof t !== 'string')) {
      errors.push({ field: 'allergies', code: 'INVALID_TYPE', message: 'allergies 必须是字符串数组' });
    }
  }

  if (row.systemicDiseases != null) {
    if (!Array.isArray(row.systemicDiseases) || row.systemicDiseases.some((t) => typeof t !== 'string')) {
      errors.push({ field: 'systemicDiseases', code: 'INVALID_TYPE', message: 'systemicDiseases 必须是字符串数组' });
    }
  }

  return { rowIndex, errors };
}

export function normalizePatientRow(row: PatientImportRow): PatientImportRow {
  const normalized: PatientImportRow = { ...row };
  if (!normalized.source || !SOURCE_VALUES.has(normalized.source as PatientSource)) {
    normalized.source = PatientSource.WALK_IN;
  }
  if (normalized.tags == null) normalized.tags = [];
  if (normalized.allergies == null) normalized.allergies = [];
  if (normalized.systemicDiseases == null) normalized.systemicDiseases = [];
  return normalized;
}
