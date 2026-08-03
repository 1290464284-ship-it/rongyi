import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../domain/resources';
import type { ResourceDefinition, ResourceField, UserRole } from '../../domain/contracts';

/**
 * Compatibility adapter for tables that exist in the legacy database but are
 * not explicitly declared in the new resource registry.
 *
 * The definition is derived from SQLite PRAGMA metadata so legacy tables keep
 * their existing columns and data without requiring a manual field migration.
 */

const LEGACY_TABLE_NAMES = [
  'Appointment', 'AuditLog', 'AutoFollowUpRule', 'BackupRecord', 'BusinessAlert',
  'CephalometricAnalysis', 'CephalometricAnalysisRecord', 'CephalometricLandmarkSet',
  'CephalometricNormValue', 'Chair', 'Charge', 'ChargeAssociationIgnore',
  'ChargeAssociationRule', 'ChargeCombo', 'ChargeComboItem', 'ChargeItem', 'Clinic',
  'ClinicInfo', 'DataImportJob', 'DebtPayment', 'DebtRecord', 'DoctorPerformanceAnomaly',
  'DrugCatalog', 'DrugContraindication', 'Equipment', 'Family', 'FirstExam',
  'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FollowUp',
  'FollowUpAssignment', 'FollowUpItem', 'FollowUpResult', 'FollowUpTemplate',
  'IdempotencyRecord', 'Imaging', 'InventoryItem', 'InventoryReplenishmentSuggestion',
  'InventoryTransaction', 'LeaveRequest', 'MedicalRecord', 'MedicalRecordPhrase',
  'MedicalRecordTemplate', 'MemberCard', 'MemberCardLog', 'MemberPointLog', 'Notification',
  'NpsSnapshot', 'OperationLog', 'OralExamination', 'Patient', 'PatientRfmScore',
  'PatientRiskScore', 'PaymentMethod', 'PeriodontalRecord', 'Prescription',
  'PrescriptionItem', 'PrintTemplate', 'ProcessingFactory', 'ProcessingFlowLog',
  'ProcessingOrder', 'ProcessingOrderItem', 'ProcessingProduct', 'PurchaseOrder',
  'PurchaseOrderItem', 'RecordModifyRequest', 'Refund', 'Registration', 'SatisfactionSurvey',
  'StaffLeaveRequest', 'StaffSchedule', 'Supplier', 'SystemAlert', 'ToothRecord',
  'Treatment', 'TreatmentCatalog', 'TreatmentPlan', 'TreatmentPlanItem',
  'TreatmentProgressSnapshot', 'UsedRefreshToken', 'User', 'Visit', 'WechatMessage',
  'WorkSchedule', 'schema_migrations',
] as const;

const dynamicCache = new Map<string, ResourceDefinition>();

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}

function typeToFieldType(sqlType: string): ResourceField['type'] {
  const type = sqlType.toUpperCase();
  if (type.includes('INT') || type.includes('REAL') || type.includes('NUM')) return 'number';
  if (type.includes('BLOB')) return 'text';
  return 'text';
}

function buildDefinition(db: Database.Database, table: string): ResourceDefinition | undefined {
  if (!tableExists(db, table)) return undefined;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
  }>;
  const base = new Set(['id', 'clinicId', 'createdAt', 'updatedAt', 'deletedAt']);
  const fields = columns
    .filter((column) => !base.has(column.name))
    .map((column) => ({
      name: column.name,
      type: typeToFieldType(column.type),
    }));
  const searchableFields = fields
    .filter((field) => field.type === 'text')
    .slice(0, 5)
    .map((field) => field.name);
  const roles: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'TECHNICIAN'];
  return {
    name: table,
    table,
    fields,
    searchableFields,
    defaultSort: { field: columns.some((column) => column.name === 'createdAt') ? 'createdAt' : 'id', order: 'DESC' },
    capabilities: {
      list: true,
      create: !['AuditLog', 'OperationLog', 'schema_migrations', 'UsedRefreshToken', 'NpsSnapshot'].includes(table),
      update: !['AuditLog', 'OperationLog', 'schema_migrations', 'UsedRefreshToken', 'NpsSnapshot'].includes(table),
      delete: !['AuditLog', 'OperationLog', 'schema_migrations', 'UsedRefreshToken', 'NpsSnapshot'].includes(table),
      softDelete: columns.some((column) => column.name === 'deletedAt'),
    },
    roles,
    audit: false,
  };
}

export function resolveResource(db: Database.Database, name: string): ResourceDefinition | undefined {
  const explicit = resourceRegistry.get(name);
  if (explicit) return explicit;
  if (!LEGACY_TABLE_NAMES.includes(name as (typeof LEGACY_TABLE_NAMES)[number])) return undefined;
  if (dynamicCache.has(name)) return dynamicCache.get(name);
  const dynamic = buildDefinition(db, name);
  if (dynamic) dynamicCache.set(name, dynamic);
  if (dynamic) return dynamic;
  return explicit;
}

export function listAllResources(db: Database.Database): ResourceDefinition[] {
  const definitions = [...resourceRegistry.all()];
  const names = new Set(definitions.map((definition) => definition.name));
  for (const table of LEGACY_TABLE_NAMES) {
    if (names.has(table)) continue;
    const definition = resolveResource(db, table);
    if (definition) definitions.push(definition);
  }
  return definitions;
}
