import type { ResourceDefinition } from '../contracts';
import { f, crud, boss } from './shared';

/** financeResources：7 个资源定义（见原 resources.ts 分组） */
export const financeResources: ResourceDefinition[] = [
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
  ], { roles: boss, audit: true, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false }, searchIndexResource: 'Charge' }),

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
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('debtRecords', 'Debt', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('totalAmount', 'money', { required: true }),
    f('paidAmount', 'money', { default: 0 }),
    f('status', 'enum', { required: true, enumValues: ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] }),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

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
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('memberCardLogs', 'MemberCardLog', [
    f('cardId', 'relation', { required: true, relation: { resource: 'memberCards', foreignKey: 'cardId', labelField: 'cardNo' } }),
    f('type', 'text', { required: true }),
    f('amount', 'money', { required: true }),
    f('balanceAfter', 'money', { required: true }),
    f('referenceId', 'text'),
    f('remark', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('memberPointLogs', 'MemberPointLog', [
    f('cardId', 'relation', { required: true, relation: { resource: 'memberCards', foreignKey: 'cardId', labelField: 'cardNo' } }),
    f('type', 'text', { required: true }),
    f('points', 'number', { required: true }),
    f('pointsAfter', 'number', { required: true }),
    f('referenceId', 'text'),
    f('remark', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

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
  ], { roles: boss, audit: true, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

];
