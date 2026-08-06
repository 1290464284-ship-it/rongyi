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
 *
 * TODO: 统一 entityName 映射说明
 * 当前 registry 中的 resource.name 与对应实体表名存在两套命名约定：
 * - 多数资源：resource.name（复数形式，如 patients / appointments）→ 通过 contracts 中 ResourceDefinition.table 映射到实体类名（如 Patient / Appointment）
 * - 少数例外：imaging（无 s）、firstExamTeeth、memberCardLogs、memberPointLogs 等名称与 table 不一致
 * 迁移时需梳理所有 name→table 的映射，统一为单一命名策略（建议始终以 domain entity 名为准），并在 resourceRegistry 中提供 name↔entity 双向查询辅助函数。
 */

const boss: UserRole[] = ['BOSS'];
const staff: UserRole[] = ['BOSS', 'DOCTOR'];
const clinical: UserRole[] = ['BOSS', 'DOCTOR'];
const reception: UserRole[] = ['BOSS', 'DOCTOR'];

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
    f('role', 'enum', { required: true, enumValues: ['BOSS', 'DOCTOR'] }),
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
    f('isTempPatient', 'boolean', { default: false }),
  ], { roles: reception, searchIndexResource: 'Patient' }),

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
    f('purpose', 'text'),
    f('tempPatientName', 'text'),
    f('tempPatientPhone', 'text'),
  ], { roles: reception, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true }, searchIndexResource: 'Appointment' }),

  crud('registrations', 'Registration', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('departmentId', 'relation', { relation: { resource: 'departments', foreignKey: 'departmentId', labelField: 'name' } }),
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
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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
    f('followUpStatus', 'enum', { enumValues: ['NONE', 'PENDING', 'HORIZONTAL_SHOULD', 'HORIZONTAL_DONE', 'LOST'] }),
    f('lossReasonType', 'text'),
    f('lossReason', 'longText'),
    f('nextFollowUpAt', 'date'),
    f('trackingNote', 'longText'),
    f('dentition', 'enum', { enumValues: ['DECIDUOUS', 'PERMANENT', 'MIXED'] }),
    f('previousExamId', 'text'),
    f('restartedAt', 'datetime'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('firstExamTeeth', 'FirstExamTooth', [
    f('examId', 'relation', { required: true, relation: { resource: 'firstExams', foreignKey: 'examId', labelField: 'id' } }),
    f('toothNumber', 'number', { required: true }),
    f('toothStatus', 'text', { required: true }),
    f('diseases', 'json', { default: '[]' }),
    f('isChief', 'boolean', { default: false }),
    f('chiefMark', 'enum', { enumValues: ['NONE', 'HORIZONTAL_SHOULD', 'HORIZONTAL_DONE'] }),
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
    f('editRequestStatus', 'enum', { enumValues: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] }),
    f('editRequestReason', 'longText'),
    f('editRequestedById', 'text'),
    f('editRequestedAt', 'datetime'),
    f('reviewedById', 'text'),
    f('reviewedAt', 'datetime'),
    f('reviewNote', 'longText'),
    f('proposedContentJson', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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
    f('categoryId', 'text'),
    f('phase', 'enum', { enumValues: ['INITIAL', 'IN_PROGRESS', 'FINISHED', 'RETENTION', 'OTHER'] }),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('treatmentCatalogs', 'TreatmentCatalog', [
    f('code', 'text', { required: true, unique: true, searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('remark', 'longText'),
    f('costType', 'enum', { enumValues: ['SERVICE', 'MATERIAL'] }),
    f('anesthesia', 'boolean', { default: false }),
    f('parentId', 'text'),
    f('businessCategory', 'enum', { enumValues: ['SERVICE', 'DRUG', 'MATERIAL', 'OTHER'] }),
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
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  // R2-P1-19: 允许软删除（无级联），供创建失败时客户端清理孤儿主记录/明细
  crud('treatmentPlans', 'TreatmentPlan', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('status', 'text', { required: true }),
    f('totalFee', 'money', { required: true }),
    f('remark', 'longText'),
    f('printCount', 'number', { default: 0 }),
    f('lastPrintedAt', 'datetime'),
    f('patientSignature', 'text'),
    f('signedAt', 'datetime'),
    f('signerName', 'text'),
    f('signatureRemark', 'longText'),
    f('discountType', 'enum', { enumValues: ['NONE', 'WHOLE', 'DOUBLE'] }),
    f('discountRate', 'number', { min: 0, max: 100 }),
    f('followUpStatus', 'enum', { enumValues: ['NONE', 'PENDING', 'HORIZONTAL_SHOULD', 'HORIZONTAL_DONE', 'LOST'] }),
    f('nextFollowUpAt', 'date'),
    f('trackingNote', 'longText'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  // R2-P1-19: 允许软删除（无级联），供创建失败时客户端清理孤儿主记录/明细
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
    f('discountRate', 'number', { min: 0, max: 100 }),
    f('billed', 'boolean', { default: false }),
    f('billedChargeId', 'text'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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
    f('payMethodName', 'text'),
    f('paidAt', 'datetime'),
    f('memberCardId', 'relation', { relation: { resource: 'memberCards', foreignKey: 'memberCardId', labelField: 'cardNo' } }),
    f('remark', 'longText'),
    f('discountPlanSnapshotJson', 'json', { default: '{}' }),
  ], { roles: reception, audit: true, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false }, searchIndexResource: 'Charge' }),

  crud('chargeItems', 'ChargeItem', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('treatmentId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('teethNumbers', 'json', { default: '[]' }),
    f('subtotal', 'money', { required: true }),
    f('costType', 'enum', { enumValues: ['SERVICE', 'MATERIAL'] }),
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
    f('discountRate', 'number', { min: 0, max: 100 }),
    f('maxDiscountAmount', 'money', { min: 0 }),
    f('roundingMode', 'enum', { enumValues: ['FLOOR', 'ROUND', 'NONE'] }),
    f('annualDiscountLimit', 'number', { min: 0 }),
    f('specialDiscountsJson', 'json', { default: '[]' }),
  ], { roles: reception, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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
    f('status', 'enum', { enumValues: ['REQUESTED', 'PENDING_REFUND', 'COMPLETED', 'REJECTED', 'CANCELLED'] }),
    f('approvedById', 'text'),
    f('approvedAt', 'datetime'),
    f('processedById', 'text'),
    f('processedAt', 'datetime'),
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

  // R2-P1-19: 允许软删除（无级联），供创建失败时客户端清理孤儿主记录/明细
  crud('prescriptions', 'Prescription', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('visitId', 'relation', { relation: { resource: 'visits', foreignKey: 'visitId', labelField: 'id' } }),
    f('doctorId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('remark', 'longText'),
    f('status', 'text', { default: 'DRAFT' }),
    f('processedAt', 'datetime'),
    f('chargeId', 'relation', { relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('dispenseId', 'text'),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  // R2-P1-19: 允许软删除（无级联），供创建失败时客户端清理孤儿主记录/明细
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
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('suppliers', 'Supplier', [
    f('code', 'text', { searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('contactPerson', 'text'),
    f('phone', 'text'),
    f('address', 'longText'),
    f('bankAccount', 'text'),
    f('remark', 'longText'),
  ], { roles: boss, searchIndexResource: 'Supplier' }),

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
    f('batchManaged', 'boolean', { default: false }),
    f('isHighValue', 'boolean', { default: false }),
    f('catalogId', 'text'),
  ], { roles: ['BOSS'], capabilities: { list: true, create: true, update: true, delete: false, softDelete: false }, searchIndexResource: 'InventoryItem' }),

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
    f('batchId', 'text'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false }, audit: true }),

  crud('purchaseOrders', 'PurchaseOrder', [
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('supplierId', 'relation', { required: true, relation: { resource: 'suppliers', foreignKey: 'supplierId', labelField: 'name' } }),
    f('totalAmount', 'money', { required: true }),
    f('status', 'text', { required: true }),
    f('receivedAt', 'datetime'),
    f('reviewStatus', 'enum', { enumValues: ['PENDING', 'APPROVED', 'REJECTED'] }),
    f('approvedById', 'text'),
    f('approvedAt', 'datetime'),
    f('rejectionReason', 'longText'),
    f('receivedById', 'text'),
  ], { roles: boss, audit: true, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('purchaseOrderItems', 'PurchaseOrderItem', [
    f('orderId', 'relation', { required: true, relation: { resource: 'purchaseOrders', foreignKey: 'orderId', labelField: 'number' } }),
    f('itemId', 'relation', { relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('unitPrice', 'money', { required: true }),
    f('subtotal', 'money', { required: true }),
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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
    f('settleStatus', 'enum', { enumValues: ['UNSETTLED', 'SETTLED'] }),
    f('settledAmount', 'money', { min: 0 }),
    f('settledAt', 'datetime'),
    f('settlementNote', 'longText'),
    f('settlementRef', 'text'),
  ], { roles: reception, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('processingOrderItems', 'ProcessingOrderItem', [
    f('orderId', 'relation', { required: true, relation: { resource: 'processingOrders', foreignKey: 'orderId', labelField: 'number' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('unitPrice', 'money', { required: true }),
    f('subtotal', 'money', { required: true }),
    f('status', 'text', { required: true }),
  ], { roles: reception, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('cephalometricCases', 'CephalometricCase', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('imageUrl', 'text', { required: true }),
    f('landmarksJson', 'json', { default: '{}' }),
    f('metricsJson', 'json', { default: '{}' }),
    f('templateId', 'text'),
    f('status', 'text', { default: 'DRAFT' }),
    f('remark', 'longText'),
    f('reportJson', 'json', { default: '{}' }),
    f('reportStatus', 'text', { default: 'DRAFT' }),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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
    f('executionStatus', 'enum', { enumValues: ['PENDING', 'DONE', 'SKIPPED'] }),
    f('patientRating', 'number', { min: 0, max: 10 }),
    f('painLevel', 'number', { min: 0, max: 10 }),
    f('feedback', 'longText'),
    f('contactedAt', 'datetime'),
    f('nextPlanDate', 'date'),
  ], { roles: reception, audit: true, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false }, searchIndexResource: 'FollowUp' }),

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
    f('riskMultiplierLow', 'decimal', { default: 1 }),
    f('riskMultiplierMedium', 'decimal', { default: 1 }),
    f('riskMultiplierHigh', 'decimal', { default: 0.75 }),
    f('riskMultiplierExtreme', 'decimal', { default: 0.5 }),
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

  crud('wechatReminders', 'WechatReminder', [
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('scene', 'enum', { required: true, enumValues: ['APPOINTMENT_REMINDER', 'TREATMENT_RECALL', 'FIRST_EXAM_NUDGE'] }),
    f('scheduledDate', 'date', { required: true }),
    f('sourceId', 'text'),
    f('content', 'longText'),
    f('status', 'enum', { required: true, enumValues: ['PENDING', 'SENT', 'DISMISSED'] }),
    f('sentAt', 'datetime'),
    f('sentBy', 'text'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

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
    f('shiftTemplateId', 'text'),
    f('title', 'text'),
    f('weekDay', 'number', { min: 0, max: 6 }),
    f('color', 'text'),
    f('isRecurring', 'boolean', { default: false }),
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
  ], { roles: ['BOSS'], capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

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
  ], { roles: ['BOSS'] }),

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
  ], { roles: ['BOSS'], capabilities: { list: true, create: false, update: false, delete: false, softDelete: true } }),

  // 药品/耗材批次（批次管理+效期提醒）
  crud('inventoryBatches', 'InventoryBatch', [
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('batchNo', 'text', { searchable: true }),
    f('productionDate', 'date'),
    f('expiryDate', 'date'),
    f('initialQuantity', 'number', { required: true, min: 0 }),
    f('remainingQuantity', 'number', { required: true, min: 0 }),
    f('supplierId', 'relation', { relation: { resource: 'suppliers', foreignKey: 'supplierId', labelField: 'name' } }),
    f('purchaseOrderId', 'text'),
    f('active', 'boolean', { default: true }),
  ], { roles: ['BOSS'], capabilities: { list: true, create: true, update: true, delete: false, softDelete: false } }),

  // 库存盘点（开启锁定→差异→结束解锁）
  crud('stocktakes', 'Stocktake', [
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('status', 'enum', { required: true, enumValues: ['IN_PROGRESS', 'LOCKED', 'COMPLETED', 'CANCELLED'] }),
    f('startedById', 'relation', { relation: { resource: 'users', foreignKey: 'startedById', labelField: 'name' } }),
    f('startedAt', 'datetime'),
    f('completedById', 'relation', { relation: { resource: 'users', foreignKey: 'completedById', labelField: 'name' } }),
    f('completedAt', 'datetime'),
    f('note', 'longText'),
  ], { roles: ['BOSS'], capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  crud('stocktakeItems', 'StocktakeItem', [
    f('stocktakeId', 'relation', { required: true, relation: { resource: 'stocktakes', foreignKey: 'stocktakeId', labelField: 'number' } }),
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('systemStock', 'number', { required: true, min: 0 }),
    f('countedStock', 'number', { min: 0 }),
    f('difference', 'number', { default: 0 }),
    f('note', 'longText'),
  ], { roles: ['BOSS'], capabilities: { list: true, create: true, update: true, delete: false, softDelete: false } }),

  // 收费组合（公有/私有，划价一键调出）
  crud('chargeCombos', 'ChargeCombo', [
    f('code', 'text', { required: true, unique: true, searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('type', 'enum', { required: true, enumValues: ['PUBLIC', 'PRIVATE'] }),
    f('ownerId', 'relation', { relation: { resource: 'users', foreignKey: 'ownerId', labelField: 'name' } }),
    f('active', 'boolean', { default: true }),
  ], { roles: ['BOSS', 'DOCTOR'], capabilities: { list: true, create: true, update: true, delete: false, softDelete: false } }),

  crud('chargeComboItems', 'ChargeComboItem', [
    f('comboId', 'relation', { required: true, relation: { resource: 'chargeCombos', foreignKey: 'comboId', labelField: 'name' } }),
    f('catalogId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('costType', 'enum', { enumValues: ['SERVICE', 'MATERIAL'] }),
  ], { roles: ['BOSS', 'DOCTOR'], capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  // 预约事项自定义
  crud('appointmentPurposes', 'AppointmentPurpose', [
    f('name', 'text', { required: true, searchable: true }),
    f('color', 'text'),
    f('sortOrder', 'number', { default: 0 }),
    f('active', 'boolean', { default: true }),
  ], { roles: reception, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  // 班次模板（固定排班）
  crud('shiftTemplates', 'ShiftTemplate', [
    f('name', 'text', { required: true, searchable: true }),
    f('startTime', 'text', { required: true }),
    f('endTime', 'text', { required: true }),
    f('workDaysJson', 'json', { default: '[1,2,3,4,5]' }),
    f('color', 'text'),
    f('active', 'boolean', { default: true }),
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  // 药房工作台（领药/退库）
  crud('dispenses', 'Dispense', [
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('chargeId', 'relation', { relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('prescriptionId', 'text'),
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('pharmacistId', 'relation', { relation: { resource: 'users', foreignKey: 'pharmacistId', labelField: 'name' } }),
    f('status', 'enum', { required: true, enumValues: ['PENDING', 'PARTIAL', 'DISPENSED', 'RETURNED'] }),
    f('dispensedAt', 'datetime'),
    f('returnedAt', 'datetime'),
    f('note', 'longText'),
  ], { roles: ['BOSS', 'DOCTOR'], capabilities: { list: true, create: true, update: true, delete: false, softDelete: false } }),

  crud('dispenseItems', 'DispenseItem', [
    f('dispenseId', 'relation', { required: true, relation: { resource: 'dispenses', foreignKey: 'dispenseId', labelField: 'number' } }),
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('batchId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('returnedQuantity', 'number', { default: 0, min: 0 }),
  ], { roles: ['BOSS', 'DOCTOR'], capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  // 麻药登记表
  crud('narcoticRegistry', 'NarcoticRegistry', [
    f('recordDate', 'date', { required: true }),
    f('patientId', 'relation', { relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('doctorId', 'relation', { relation: { resource: 'users', foreignKey: 'doctorId', labelField: 'name' } }),
    f('pharmacistId', 'relation', { relation: { resource: 'users', foreignKey: 'pharmacistId', labelField: 'name' } }),
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('batchNo', 'text'),
    f('quantity', 'number', { required: true, min: 0 }),
    f('unit', 'text'),
    f('usage', 'text'),
    f('balanceBefore', 'number', { min: 0 }),
    f('balanceAfter', 'number', { min: 0 }),
    f('remark', 'longText'),
  ], { roles: ['BOSS'], capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

  // 影像分类（正畸/美学/石膏）
  crud('imagingCategories', 'ImagingCategory', [
    f('name', 'text', { required: true, searchable: true }),
    f('type', 'enum', { required: true, enumValues: ['ORTHODONTIC', 'AESTHETIC', 'PLASTER', 'OTHER'] }),
    f('parentId', 'text'),
    f('sortOrder', 'number', { default: 0 }),
    f('active', 'boolean', { default: true }),
  ], { roles: clinical, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  // 多岗位角色（一人多角色）——UserRole 为复合主键表（无 id 列），通用资源路由无法写入，
  // 仅开放 list；读写走专用服务路由 /api/v2/user-roles（UserRoleService）。
  crud('userRoles', 'UserRole', [
    f('userId', 'relation', { required: true, relation: { resource: 'users', foreignKey: 'userId', labelField: 'name' } }),
    f('role', 'enum', { required: true, enumValues: ['BOSS', 'DOCTOR'] }),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  // 角色权限树配置
  crud('rolePermissions', 'RolePermission', [
    f('role', 'enum', { required: true, enumValues: ['BOSS', 'DOCTOR'] }),
    f('resource', 'text', { required: true, searchable: true }),
    f('permission', 'text', { required: true }),
    f('allowed', 'boolean', { default: true }),
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: false } }),

  // ===== R2 第二批：12 功能块新增资源 =====

  // 分诊科室词典（挂号/分诊按科室维度）
  crud('departments', 'Department', [
    f('name', 'text', { required: true, unique: true, searchable: true }),
    f('active', 'boolean', { default: true }),
    f('sortOrder', 'number', { default: 0 }),
    f('remark', 'longText'),
  ], { roles: reception }),

  // 回访基础词典（类型/项目/内容/结果/沟通方式）
  crud('followUpDicts', 'FollowUpDict', [
    f('dictType', 'enum', { required: true, enumValues: ['TYPE', 'PROJECT', 'CONTENT', 'RESULT', 'COMMUNICATION'] }),
    f('name', 'text', { required: true, searchable: true }),
    f('sortOrder', 'number', { default: 0 }),
    f('active', 'boolean', { default: true }),
    f('remark', 'longText'),
  ], { roles: reception }),

  // 自定义缴费方式（支持二级支付方式 parentId）
  crud('payMethods', 'PayMethod', [
    f('name', 'text', { required: true, searchable: true }),
    f('parentId', 'text'),
    f('sortOrder', 'number', { default: 0 }),
    f('active', 'boolean', { default: true }),
    f('remark', 'longText'),
  ], { roles: reception }),

  // 加工流程步骤词典（自定义加工流程）
  crud('processingFlowSteps', 'ProcessingFlowStep', [
    f('name', 'text', { required: true, searchable: true }),
    f('sortOrder', 'number', { default: 0 }),
    f('active', 'boolean', { default: true }),
    f('remark', 'longText'),
  ], { roles: reception }),

  // 加工单步骤进度（按词典顺序推进，可手动改）
  crud('processingOrderSteps', 'ProcessingOrderStep', [
    f('orderId', 'relation', { required: true, relation: { resource: 'processingOrders', foreignKey: 'orderId', labelField: 'number' } }),
    f('stepId', 'text'),
    f('stepName', 'text', { required: true }),
    f('status', 'enum', { required: true, enumValues: ['PENDING', 'IN_PROGRESS', 'DONE'] }),
    f('sortOrder', 'number', { default: 0 }),
    f('startedAt', 'datetime'),
    f('completedAt', 'datetime'),
    f('operatorId', 'text'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  // 库存独立单据（退回厂商/库损/调拨），写操作走专用服务
  crud('inventoryDocs', 'InventoryDoc', [
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('type', 'enum', { required: true, enumValues: ['RETURN_SUPPLIER', 'LOSS', 'TRANSFER'] }),
    f('supplierId', 'relation', { relation: { resource: 'suppliers', foreignKey: 'supplierId', labelField: 'name' } }),
    f('status', 'enum', { required: true, enumValues: ['DRAFT', 'COMPLETED', 'CANCELLED'] }),
    f('operatorId', 'text'),
    f('operatorName', 'text'),
    f('completedAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('inventoryDocItems', 'InventoryDocItem', [
    f('docId', 'relation', { required: true, relation: { resource: 'inventoryDocs', foreignKey: 'docId', labelField: 'number' } }),
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('toItemId', 'relation', { relation: { resource: 'inventoryItems', foreignKey: 'toItemId', labelField: 'name' } }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('unitPrice', 'money'),
    f('remark', 'longText'),
  ], { roles: reception, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),
];

export const INTERNAL_RESOURCE_TABLES = new Set([
  'BackupRecord',
  'IdempotencyRecord',
  'SyncChange',
  'SyncDevice',
  'UsedRefreshToken',
  'UserClinic',
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
