import type {
  ResourceDefinition,
  ResourceField,
  ResourceRegistry,
  UserRole,
} from './contracts';
import { legacyResources } from './legacy-resources.generated';

/**
 * Declarative resource registry.
 *
 * Simple CRUD resources are expressed here instead of in duplicated routers and
 * repositories. Complex workflows still live in dedicated application use cases.
 */

const boss: UserRole[] = ['BOSS'];
const staff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'TECHNICIAN'];
const clinical: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'NURSE'];
const reception: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE'];

function f(
  name: string,
  type: ResourceField['type'],
  options: Partial<ResourceField> = {},
): ResourceField {
  return { name, type, ...options };
}

function crud(
  name: string,
  table: string,
  fields: ResourceField[],
  options: Partial<ResourceDefinition> = {},
): ResourceDefinition {
  return {
    name,
    table,
    fields,
    searchableFields: fields.filter((field) => field.searchable).map((field) => field.name),
    defaultSort: { field: 'createdAt', order: 'DESC' },
    capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
    roles: staff,
    audit: false,
    ...options,
  };
}

const resources: ResourceDefinition[] = [
  crud('clinics', 'Clinic', [
    f('code', 'text', { required: true, unique: true, searchable: true, maxLength: 64 }),
    f('name', 'text', { required: true, searchable: true, maxLength: 128 }),
    f('address', 'longText'),
    f('phone', 'text'),
    f('active', 'boolean', { default: true }),
  ], { roles: boss }),

  crud('users', 'User', [
    f('username', 'text', { required: true, unique: true, searchable: true, maxLength: 64 }),
    f('passwordHash', 'text', { required: true, maxLength: 200 }),
    f('name', 'text', { required: true, searchable: true, maxLength: 64 }),
    f('role', 'enum', { required: true, enumValues: ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'TECHNICIAN'] }),
    f('phone', 'text'),
    f('active', 'boolean', { default: true }),
    f('loginAttempts', 'number', { default: 0 }),
    f('lockedUntil', 'datetime'),
    f('tokenVersion', 'number', { default: 0 }),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('patients', 'Patient', [
    f('code', 'text', { required: true, unique: true, searchable: true, maxLength: 64 }),
    f('name', 'text', { required: true, searchable: true, maxLength: 64 }),
    f('gender', 'enum', { required: true, enumValues: ['MALE', 'FEMALE', 'UNKNOWN'] }),
    f('phone', 'text', { searchable: true, maxLength: 32 }),
    f('birthDate', 'date'),
    f('idCard', 'text'),
    f('address', 'longText'),
    f('occupation', 'text'),
    f('remark', 'longText'),
    f('avatar', 'text'),
    f('tags', 'json', { default: '[]' }),
    f('allergies', 'json', { default: '[]' }),
    f('medicalHistory', 'json', { default: '[]' }),
    f('medicationHistory', 'json', { default: '[]' }),
    f('systemicDiseases', 'json', { default: '[]' }),
    f('source', 'enum', { required: true, enumValues: ['WALK_IN', 'REFERRAL', 'ONLINE', 'OTHER'] }),
    f('active', 'boolean', { default: true }),
  ], { roles: reception }),

  crud('familyMembers', 'FamilyMember', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('relationship', 'text', { required: true }),
    f('phone', 'text'),
  ], { roles: reception }),

  crud('patientRiskScores', 'PatientRiskScore', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('cariesScore', 'number', { required: true, min: 0, max: 100 }),
    f('periodontalScore', 'number', { required: true, min: 0, max: 100 }),
    f('implantScore', 'number', { required: true, min: 0, max: 100 }),
    f('cariesLevel', 'enum', { required: true, enumValues: ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] }),
    f('periodontalLevel', 'enum', { required: true, enumValues: ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] }),
    f('implantLevel', 'enum', { required: true, enumValues: ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] }),
    f('factorSnapshotJson', 'json', { required: true }),
    f('assessedById', 'relation', { relation: { resource: 'users', foreignKey: 'assessedById', labelField: 'name' } }),
  ], { roles: clinical, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('chairs', 'Chair', [
    f('name', 'text', { required: true, searchable: true, maxLength: 64 }),
    f('location', 'text'),
    f('active', 'boolean', { default: true }),
  ], { roles: reception }),

  crud('appointments', 'Appointment', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('chairId', 'relation', { relation: { resource: 'chairs', foreignKey: 'chairId', labelField: 'name' } }),
    f('startTime', 'datetime', { required: true }),
    f('endTime', 'datetime', { required: true }),
    f('status', 'enum', { required: true, enumValues: ['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] }),
    f('type', 'enum', { required: true, enumValues: ['REGULAR', 'FOLLOW_UP', 'EMERGENCY', 'CONSULTATION'] }),
    f('remark', 'longText'),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('registrations', 'Registration', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('type', 'enum', { required: true, enumValues: ['REGULAR', 'EMERGENCY', 'FOLLOW_UP'] }),
    f('status', 'enum', { required: true, enumValues: ['REGISTERED', 'TRIAGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('appointmentId', 'relation', { relation: { resource: 'appointments', foreignKey: 'appointmentId', labelField: 'id' } }),
    f('triageNote', 'longText'),
    f('chiefComplaint', 'longText'),
    f('registeredBy', 'relation', { relation: { resource: 'users', foreignKey: 'registeredBy', labelField: 'name' } }),
    f('registeredAt', 'datetime', { required: true }),
    f('triagedAt', 'datetime'),
    f('startedAt', 'datetime'),
    f('completedAt', 'datetime'),
  ], { roles: reception, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('visits', 'Visit', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('appointmentId', 'relation', { relation: { resource: 'appointments', foreignKey: 'appointmentId', labelField: 'id' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('chiefComplaint', 'longText'),
    f('diagnosis', 'longText'),
    f('treatmentPlan', 'longText'),
    f('summary', 'longText'),
    f('startTime', 'datetime', { required: true }),
    f('endTime', 'datetime'),
    f('status', 'enum', { required: true, enumValues: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] }),
    f('nextReminder', 'date'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('firstExams', 'FirstExam', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('consultantId', 'relation', { relation: { resource: 'users', foreignKey: 'consultantId', labelField: 'name' } }),
    f('chiefComplaint', 'longText'),
    f('presentIllness', 'longText'),
    f('pastHistory', 'longText'),
    f('oralExam', 'longText'),
    f('auxiliaryExam', 'longText'),
    f('diagnosis', 'longText'),
    f('treatmentSuggestion', 'longText'),
    f('status', 'text', { required: true }),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('firstExamTeeth', 'FirstExamTooth', [
    f('examId', 'relation', { required: true, relation: { resource: 'firstExams', foreignKey: 'examId', labelField: 'id' } }),
    f('toothNumber', 'number', { required: true }),
    f('toothStatus', 'text', { required: true }),
    f('diseases', 'json', { default: '[]' }),
    f('isChief', 'boolean', { default: false }),
    f('treatmentPlan', 'longText'),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('oralExaminations', 'OralExamination', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('examDate', 'date', { required: true }),
    f('data', 'json', { required: true }),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('periodontalRecords', 'PeriodontalRecord', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('examDate', 'date', { required: true }),
    f('data', 'json', { required: true }),
    f('plaqueIndex', 'number'),
    f('boneLoss', 'text'),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('medicalRecords', 'MedicalRecord', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('templateId', 'text'),
    f('isTemplate', 'boolean', { default: false }),
    f('category', 'text'),
    f('chiefComplaint', 'longText'),
    f('presentIllness', 'longText'),
    f('pastHistory', 'longText'),
    f('allergyHistory', 'longText'),
    f('examination', 'longText'),
    f('diagnosis', 'longText'),
    f('treatmentPlan', 'longText'),
    f('teethInvolved', 'json', { default: '[]' }),
    f('images', 'json', { default: '[]' }),
    f('isLocked', 'boolean', { default: false }),
    f('lockedAt', 'datetime'),
    f('lockedBy', 'text'),
    f('signature', 'text'),
    f('status', 'text', { required: true }),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('medicalPhrases', 'MedicalPhrase', [
    f('category', 'text', { required: true }),
    f('content', 'longText', { required: true, searchable: true }),
    f('sortOrder', 'number', { default: 0 }),
  ], { roles: clinical }),

  crud('toothRecords', 'ToothRecord', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('toothNumber', 'number', { required: true }),
    f('currentStatus', 'text', { required: true }),
    f('conditions', 'json', { default: '[]' }),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('imaging', 'Imaging', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('type', 'text', { required: true, searchable: true }),
    f('title', 'text', { required: true, searchable: true }),
    f('description', 'longText'),
    f('imageUrl', 'text', { required: true }),
    f('thumbnailUrl', 'text'),
    f('takenAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('treatmentCatalogs', 'TreatmentCatalog', [
    f('code', 'text', { required: true, unique: true, searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('remark', 'longText'),
  ], { roles: boss }),

  crud('treatments', 'Treatment', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('code', 'text', { required: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('teethNumbers', 'json', { default: '[]' }),
    f('status', 'enum', { required: true, enumValues: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] }),
    f('plannedDate', 'date'),
    f('completedDate', 'date'),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('treatmentPlans', 'TreatmentPlan', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('status', 'text', { required: true }),
    f('totalFee', 'money', { required: true }),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('treatmentPlanItems', 'TreatmentPlanItem', [
    f('planId', 'relation', { required: true, relation: { resource: 'treatmentPlans', foreignKey: 'planId', labelField: 'name' } }),
    f('code', 'text', { required: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('teethNumbers', 'json', { default: '[]' }),
    f('status', 'text', { required: true }),
    f('treatmentId', 'text'),
    f('completedAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('charges', 'Charge', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('totalAmount', 'money', { required: true }),
    f('paidAmount', 'money', { default: 0 }),
    f('refundedAmount', 'money', { default: 0 }),
    f('discount', 'money', { default: 0 }),
    f('status', 'enum', { required: true, enumValues: ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED'] }),
    f('payMethod', 'enum', { enumValues: ['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'DEBT', 'MEMBER_CARD', 'UNIONPAY', 'INSURANCE', 'OTHER'] }),
    f('paidAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: reception, audit: true, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('chargeItems', 'ChargeItem', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('treatmentId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('teethNumbers', 'json', { default: '[]' }),
    f('subtotal', 'money', { required: true }),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('debtRecords', 'Debt', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('totalAmount', 'money', { required: true }),
    f('paidAmount', 'money', { default: 0 }),
    f('status', 'enum', { required: true, enumValues: ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] }),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('memberCards', 'MemberCard', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('cardNo', 'text', { required: true, unique: true, searchable: true }),
    f('balance', 'money', { default: 0 }),
    f('totalRecharge', 'money', { default: 0 }),
    f('totalConsume', 'money', { default: 0 }),
    f('status', 'enum', { required: true, enumValues: ['ACTIVE', 'INACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED'] }),
    f('points', 'number', { default: 0 }),
    f('totalPoints', 'number', { default: 0 }),
    f('level', 'enum', { required: true, enumValues: ['NORMAL', 'VIP', 'SVIP'] }),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('memberCardLogs', 'MemberCardLog', [
    f('cardId', 'relation', { required: true, relation: { resource: 'memberCards', foreignKey: 'cardId', labelField: 'cardNo' } }),
    f('type', 'text', { required: true }),
    f('amount', 'money', { required: true }),
    f('balanceAfter', 'money', { required: true }),
    f('referenceId', 'text'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('memberPointLogs', 'MemberPointLog', [
    f('cardId', 'relation', { required: true, relation: { resource: 'memberCards', foreignKey: 'cardId', labelField: 'cardNo' } }),
    f('type', 'text', { required: true }),
    f('points', 'number', { required: true }),
    f('pointsAfter', 'number', { required: true }),
    f('referenceId', 'text'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('refunds', 'Refund', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('amount', 'money', { required: true, min: 1 }),
    f('reason', 'longText'),
    f('operatorId', 'text'),
    f('operatorName', 'text'),
  ], { roles: reception, audit: true, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('drugCatalogItems', 'DrugCatalogItem', [
    f('code', 'text', { required: true, unique: true, searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('specification', 'text'),
    f('unit', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('category', 'text'),
    f('active', 'boolean', { default: true }),
  ], { roles: boss }),

  crud('prescriptions', 'Prescription', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('prescriptionItems', 'PrescriptionItem', [
    f('prescriptionId', 'relation', { required: true, relation: { resource: 'prescriptions', foreignKey: 'prescriptionId', labelField: 'id' } }),
    f('drugId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('specification', 'text'),
    f('dosage', 'text'),
    f('frequency', 'text'),
    f('days', 'number', { required: true, min: 1 }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('price', 'money', { required: true }),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('suppliers', 'Supplier', [
    f('code', 'text', { searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('contactPerson', 'text'),
    f('phone', 'text'),
    f('address', 'longText'),
    f('bankAccount', 'text'),
    f('remark', 'longText'),
  ], { roles: boss }),

  crud('inventoryItems', 'InventoryItem', [
    f('code', 'text', { required: true, unique: true, searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('category', 'text', { required: true }),
    f('unit', 'text', { required: true }),
    f('stock', 'number', { default: 0, min: 0 }),
    f('minStock', 'number', { default: 0, min: 0 }),
    f('price', 'money', { required: true }),
    f('supplierId', 'relation', { relation: { resource: 'suppliers', foreignKey: 'supplierId', labelField: 'name' } }),
    f('expireDate', 'date'),
    f('location', 'text'),
    f('remark', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('inventoryTransactions', 'InventoryTransaction', [
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('type', 'enum', { required: true, enumValues: ['IN', 'OUT', 'ADJUST'] }),
    f('quantity', 'number', { required: true, min: 0 }),
    f('beforeStock', 'number', { required: true }),
    f('afterStock', 'number', { required: true }),
    f('referenceType', 'text'),
    f('referenceId', 'text'),
    f('operatorId', 'text'),
    f('remark', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false }, audit: true }),

  crud('purchaseOrders', 'PurchaseOrder', [
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('supplierId', 'relation', { required: true, relation: { resource: 'suppliers', foreignKey: 'supplierId', labelField: 'name' } }),
    f('totalAmount', 'money', { required: true }),
    f('status', 'text', { required: true }),
    f('receivedAt', 'datetime'),
  ], { roles: boss, audit: true, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('purchaseOrderItems', 'PurchaseOrderItem', [
    f('orderId', 'relation', { required: true, relation: { resource: 'purchaseOrders', foreignKey: 'orderId', labelField: 'number' } }),
    f('itemId', 'relation', { relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('unitPrice', 'money', { required: true }),
    f('subtotal', 'money', { required: true }),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('processingFactories', 'ProcessingFactory', [
    f('name', 'text', { required: true, searchable: true }),
    f('contactPerson', 'text'),
    f('phone', 'text'),
    f('address', 'longText'),
    f('status', 'text', { required: true, default: 'ACTIVE' }),
  ], { roles: reception }),

  crud('processingOrders', 'ProcessingOrder', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('factoryId', 'text'),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('shade', 'text'),
    f('teethNumbers', 'json', { default: '[]' }),
    f('totalFee', 'money', { required: true }),
    f('status', 'enum', { required: true, enumValues: ['DRAFT', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'RECEIVED', 'CANCELLED'] }),
    f('chargeId', 'relation', { relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('sentAt', 'datetime'),
    f('expectedAt', 'date'),
    f('receivedAt', 'datetime'),
    f('deliveredAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('processingOrderItems', 'ProcessingOrderItem', [
    f('orderId', 'relation', { required: true, relation: { resource: 'processingOrders', foreignKey: 'orderId', labelField: 'number' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('unitPrice', 'money', { required: true }),
    f('subtotal', 'money', { required: true }),
    f('status', 'text', { required: true }),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('cephalometricCases', 'CephalometricCase', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('imageUrl', 'text', { required: true }),
    f('landmarksJson', 'json', { default: '{}' }),
    f('metricsJson', 'json', { default: '{}' }),
    f('templateId', 'text'),
    f('status', 'text', { default: 'DRAFT' }),
    f('remark', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('smsLogs', 'SmsLog', [
    f('patientId', 'relation', { relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('phone', 'text', { required: true, searchable: true }),
    f('content', 'longText', { required: true }),
    f('type', 'text', { required: true }),
    f('status', 'text', { required: true }),
    f('result', 'longText'),
    f('sentAt', 'datetime'),
    f('cost', 'money'),
  ], { roles: reception, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('invoices', 'Invoice', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('amount', 'money', { required: true }),
    f('type', 'text', { required: true }),
    f('status', 'text', { required: true }),
    f('issuedAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('followUps', 'FollowUp', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('planDate', 'date', { required: true }),
    f('content', 'longText'),
    f('status', 'enum', { required: true, enumValues: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] }),
    f('result', 'longText'),
    f('assigneeId', 'relation', { relation: { resource: 'users', foreignKey: 'assigneeId', labelField: 'name' } }),
    f('templateId', 'text'),
    f('completedAt', 'datetime'),
  ], { roles: reception, audit: true, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('followUpTemplates', 'FollowUpTemplate', [
    f('name', 'text', { required: true, searchable: true }),
    f('type', 'text'),
    f('daysAfter', 'number', { min: 0 }),
    f('content', 'longText'),
    f('assigneeId', 'relation', { relation: { resource: 'users', foreignKey: 'assigneeId', labelField: 'name' } }),
    f('isEnabled', 'boolean', { default: true }),
    f('triggerTreatmentCodes', 'json', { default: '[]' }),
    f('triggerTreatmentCategories', 'json', { default: '[]' }),
    f('minIntervalDays', 'number', { required: true, min: 0 }),
    f('recommendedIntervalDays', 'number', { required: true, min: 0 }),
    f('maxIntervalDays', 'number', { required: true, min: 0 }),
    f('riskMultiplierLow', 'number', { default: 1 }),
    f('riskMultiplierMedium', 'number', { default: 1 }),
    f('riskMultiplierHigh', 'number', { default: 0.75 }),
    f('riskMultiplierExtreme', 'number', { default: 0.5 }),
    f('requiresAdherenceCheck', 'boolean', { default: true }),
  ], { roles: boss }),

  crud('wechatMessages', 'WechatMessage', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('type', 'text', { required: true }),
    f('content', 'longText'),
    f('status', 'text', { required: true }),
    f('templateId', 'text'),
    f('sentAt', 'datetime'),
    f('result', 'longText'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('satisfactionSurveys', 'SatisfactionSurvey', [
    f('patientId', 'relation', { relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('score', 'number', { required: true, min: 0, max: 100 }),
    f('channel', 'text', { required: true }),
    f('comment', 'longText'),
    f('surveyDate', 'date', { required: true }),
  ], { roles: reception, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('equipment', 'Equipment', [
    f('name', 'text', { required: true, searchable: true }),
    f('model', 'text'),
    f('brand', 'text'),
    f('serialNumber', 'text'),
    f('category', 'text'),
    f('location', 'text'),
    f('purchasePrice', 'money'),
    f('purchaseDate', 'date'),
    f('supplier', 'text'),
    f('status', 'enum', { required: true, enumValues: ['NORMAL', 'MAINTENANCE', 'BROKEN', 'SCRAPPED'] }),
    f('remarks', 'longText'),
  ], { roles: boss }),

  crud('workSchedules', 'WorkSchedule', [
    f('userId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'userId', labelField: 'name' } }),
    f('startTime', 'datetime', { required: true }),
    f('endTime', 'datetime', { required: true }),
    f('type', 'text', { required: true }),
    f('remark', 'longText'),
  ], { roles: boss }),

  crud('attendance', 'Attendance', [
    f('userId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'userId', labelField: 'name' } }),
    f('workDate', 'date', { required: true }),
    f('checkIn', 'datetime'),
    f('checkOut', 'datetime'),
    f('status', 'text', { required: true }),
  ], { roles: boss }),

  crud('leaveRequests', 'LeaveRequest', [
    f('userId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'userId', labelField: 'name' } }),
    f('startDate', 'date', { required: true }),
    f('endDate', 'date', { required: true }),
    f('type', 'text', { required: true }),
    f('reason', 'longText'),
    f('status', 'enum', { required: true, enumValues: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] }),
    f('reviewerId', 'text'),
    f('reviewedAt', 'datetime'),
  ], { roles: boss, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('notifications', 'Notification', [
    f('userId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'userId', labelField: 'name' } }),
    f('title', 'text', { required: true }),
    f('body', 'longText', { required: true }),
    f('kind', 'text', { required: true }),
    f('readAt', 'datetime'),
  ], { roles: staff, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('settings', 'Setting', [
    f('key', 'text', { required: true, unique: true }),
    f('value', 'text', { required: true }),
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: false } }),

  crud('businessAlerts', 'BusinessAlert', [
    f('alertType', 'enum', { required: true, enumValues: ['REVENUE_DROP', 'NEW_PATIENTS', 'NO_SHOW_RATE', 'AOV', 'INVENTORY_STOCKOUT', 'SCHEDULER_TASK_FAILURE', 'PERFORMANCE_ANOMALY', 'SATISFACTION_NEGATIVE'] }),
    f('level', 'enum', { required: true, enumValues: ['INFO', 'WARNING', 'CRITICAL'] }),
    f('severity', 'enum', { required: true, enumValues: ['INFO', 'WARN', 'CRITICAL'] }),
    f('metricName', 'text'),
    f('currentValue', 'number'),
    f('baselineValue', 'number'),
    f('deviationPercent', 'number'),
    f('title', 'text', { required: true }),
    f('message', 'longText', { required: true }),
    f('source', 'text', { required: true }),
    f('status', 'enum', { required: true, enumValues: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] }),
    f('suggestion', 'longText'),
    f('occurredAt', 'datetime'),
    f('acknowledged', 'boolean', { default: false }),
    f('acknowledgedBy', 'text'),
    f('acknowledgedAt', 'datetime'),
  ], { roles: boss, capabilities: { list: true, create: false, update: true, delete: false, softDelete: false } }),

  crud('operationLogs', 'OperationLog', [
    f('userId', 'relation', { relation: { resource: 'users', foreignKey: 'userId', labelField: 'name' } }),
    f('userName', 'text', { searchable: true }),
    f('action', 'text', { required: true, searchable: true }),
    f('target', 'text'),
    f('detail', 'longText'),
    f('ip', 'text'),
    f('traceId', 'text'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('syncChanges', 'SyncChange', [
    f('tableName', 'text', { required: true }),
    f('recordId', 'text', { required: true }),
    f('operation', 'enum', { required: true, enumValues: ['INSERT', 'UPDATE', 'DELETE'] }),
    f('deviceId', 'text', { required: true }),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('printTemplates', 'PrintTemplate', [
    f('code', 'text', { required: true, searchable: true, maxLength: 128 }),
    f('name', 'text', { required: true, searchable: true, maxLength: 128 }),
    f('category', 'text', { required: true, searchable: true }),
    f('content', 'longText', { required: true }),
    f('variables', 'json', { default: '{}' }),
    f('isDefault', 'boolean', { default: false }),
    f('paperSize', 'text'),
    f('orientation', 'text'),
    f('createdBy', 'text'),
  ], { roles: ['BOSS', 'ADMIN'] }),

  crud('dataImportJobs', 'DataImportJob', [
    f('importType', 'text', { required: true }),
    f('fileName', 'text'),
    f('totalRows', 'number', { min: 0 }),
    f('successRows', 'number', { min: 0 }),
    f('failedRows', 'number', { min: 0 }),
    f('errorReportPath', 'text'),
    f('status', 'text'),
    f('startedById', 'text'),
    f('completedAt', 'datetime'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: true } }),

  crud('inventoryReplenishmentSuggestions', 'InventoryReplenishmentSuggestion', [
    f('inventoryId', 'text', { required: true }),
    f('avgDailyConsumption', 'number', { min: 0 }),
    f('leadTimeDays', 'number', { min: 0 }),
    f('safetyFactor', 'number', { min: 0 }),
    f('rop', 'number', { min: 0 }),
    f('suggestedQty', 'number', { min: 0 }),
    f('calculationSnapshotJson', 'json'),
    f('status', 'enum', { enumValues: ['OPEN', 'APPLIED', 'IGNORED'] }),
    f('reason', 'longText'),
    f('supplierId', 'text'),
    f('totalAmount', 'money', { min: 0 }),
  ], { roles: ['BOSS', 'ADMIN'], capabilities: { list: true, create: false, update: false, delete: false, softDelete: true } }),
];

const INTERNAL_RESOURCE_TABLES = new Set([
  'BackupRecord',
  'IdempotencyRecord',
  'SyncChange',
  'SyncDevice',
  'UsedRefreshToken',
]);

const registry = new Map(resources.map((resource) => [resource.name, resource]));
/* v8 ignore start -- generated legacy definitions are pre-pruned; duplicate/internal rows are intentionally never registered. */
for (const resource of legacyResources) {
  const tableAlreadyDeclared = resources.some((candidate) => candidate.table === resource.table);
  if (!registry.has(resource.name) && !tableAlreadyDeclared && !INTERNAL_RESOURCE_TABLES.has(resource.table)) {
    registry.set(resource.name, resource);
  }
}
/* v8 ignore stop */

export const resourceRegistry: ResourceRegistry = {
  get(name) {
    return registry.get(name);
  },
  all() {
    return [...registry.values()];
  },
};
