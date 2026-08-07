import type { ResourceDefinition } from '../contracts';
import { f, crud, boss, clinical, reception } from './shared';

/** inventoryResources：12 个资源定义（见原 resources.ts 分组） */
export const inventoryResources: ResourceDefinition[] = [
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
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

  crud('processingOrderItems', 'ProcessingOrderItem', [
    f('orderId', 'relation', { required: true, relation: { resource: 'processingOrders', foreignKey: 'orderId', labelField: 'number' } }),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('unitPrice', 'money', { required: true }),
    f('subtotal', 'money', { required: true }),
    f('status', 'text', { required: true }),
  ], { roles: boss, capabilities: { list: true, create: true, update: true, delete: true, softDelete: true } }),

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

];
