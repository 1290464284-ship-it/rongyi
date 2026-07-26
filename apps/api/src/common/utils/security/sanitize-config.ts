import { sanitizeHtml, sanitizePlain } from './sanitize';

/**
 * Configuration for which columns in each table should be sanitized,
 * and whether they are plain text or rich (HTML-allowed) text.
 *
 * Add new table entries here to automatically protect all CRUD operations.
 *
 * Usage: import { sanitizeData } from '../utils/security/sanitize-config';
 *         const safe = sanitizeData('Patient', { name: '<script>', remark: '<b>ok</b>' });
 */
type ColumnType = 'plain' | 'rich';

const COLUMN_CONFIGS: Record<string, Record<string, ColumnType>> = {
  Patient: {
    name: 'plain',
    phone: 'plain',
    address: 'plain',
    remark: 'plain',
    occupation: 'plain',
  },
  Appointment: {
    type: 'plain',
    remark: 'plain',
  },
  Visit: {
    chiefComplaint: 'rich',
    diagnosis: 'rich',
    treatmentPlan: 'rich',
  },
  Treatment: {
    name: 'plain',
    category: 'plain',
    remark: 'plain',
  },
  TreatmentCatalog: {
    name: 'plain',
    category: 'plain',
    remark: 'plain',
  },
  TreatmentPlan: {
    name: 'plain',
    remark: 'plain',
  },
  TreatmentPlanItem: {
    name: 'plain',
    category: 'plain',
    remark: 'plain',
  },
  Registration: {
    type: 'plain',
    chiefComplaint: 'rich',
    triageNote: 'rich',
  },
  FirstExam: {
    chiefComplaint: 'rich',
    diagnosis: 'rich',
    treatmentSuggestion: 'rich',
    remark: 'plain',
  },
  FirstExamTooth: {
    treatmentPlan: 'rich',
    remark: 'plain',
  },
  FirstExamFollowUp: {
    content: 'rich',
  },
  OralExamination: {
    mucosa: 'rich',
    tmj: 'rich',
    remark: 'plain',
  },
  PeriodontalRecord: {
    remark: 'plain',
  },
  MedicalRecord: {
    chiefComplaint: 'rich',
    presentIllness: 'rich',
    pastHistory: 'rich',
    examination: 'rich',
    diagnosis: 'rich',
    treatmentPlan: 'rich',
  },
  MedicalRecordPhrase: {
    content: 'rich',
    name: 'plain',
    category: 'plain',
  },
  MedicalRecordTemplate: {
    name: 'plain',
    category: 'plain',
    chiefComplaint: 'rich',
    presentIllness: 'rich',
    pastHistory: 'rich',
    examination: 'rich',
    diagnosis: 'rich',
    treatmentPlan: 'rich',
  },
  RecordModifyRequest: {
    reason: 'plain',
    reviewRemark: 'plain',
  },
  Prescription: {
    remark: 'plain',
  },
  PrescriptionItem: {
    drugName: 'plain',
    spec: 'plain',
    dosage: 'plain',
    frequency: 'plain',
  },
  InventoryItem: {
    name: 'plain',
    spec: 'plain',
    category: 'plain',
    unit: 'plain',
    location: 'plain',
    remark: 'plain',
  },
  InventoryTransaction: {
    remark: 'plain',
    operatorName: 'plain',
  },
  Supplier: {
    name: 'plain',
    contactPerson: 'plain',
    phone: 'plain',
    address: 'plain',
    bankAccount: 'plain',
    remark: 'plain',
  },
  Charge: {
    remark: 'plain',
  },
  ChargeItem: {
    name: 'plain',
    category: 'plain',
  },
  ChargeCombo: {
    name: 'plain',
    category: 'plain',
  },
  PaymentMethod: {
    name: 'plain',
  },
  Refund: {
    reason: 'plain',
  },
  FollowUp: {
    content: 'rich',
    result: 'rich',
  },
  WechatMessage: {
    content: 'rich',
  },
};

/**
 * Sanitize a data object's string fields according to the column config.
 * Only sanitizes columns that are defined in COLUMN_CONFIGS for the table.
 * Non-string and undefined values are passed through unchanged.
 *
 * @param tableName - The database table name (must match a key in COLUMN_CONFIGS)
 * @param data - The record to sanitize (DTO or partial)
 * @returns A new object with sanitized string values
 */
export function sanitizeData<T extends object>(tableName: string, data: T): T {
  const config = COLUMN_CONFIGS[tableName];
  if (!config) return data;

  const sanitized = { ...data } as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    const columnType = config[key];
    if (!columnType || value === undefined || value === null) continue;

    if (typeof value === 'string') {
      sanitized[key] = columnType === 'rich' ? sanitizeHtml(value) : sanitizePlain(value);
    }
  }
  return sanitized as T;
}
