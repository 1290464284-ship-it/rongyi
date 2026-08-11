import type { ResourceDefinition } from '../contracts';
import { f, crud, boss, clinical, reception, staff } from './shared';

/** r2Resources：21 个资源定义（见原 resources.ts 分组） */
export const r2Resources: ResourceDefinition[] = [
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
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: true } }),

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
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  // 库存盘点（开启锁定→差异→结束解锁）
  crud('stocktakes', 'Stocktake', [
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('status', 'enum', { required: true, enumValues: ['IN_PROGRESS', 'LOCKED', 'COMPLETED', 'CANCELLED'] }),
    f('startedById', 'relation', { relation: { resource: 'users', foreignKey: 'startedById', labelField: 'name' } }),
    f('startedAt', 'datetime'),
    f('completedById', 'relation', { relation: { resource: 'users', foreignKey: 'completedById', labelField: 'name' } }),
    f('completedAt', 'datetime'),
    f('note', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('stocktakeItems', 'StocktakeItem', [
    f('stocktakeId', 'relation', { required: true, relation: { resource: 'stocktakes', foreignKey: 'stocktakeId', labelField: 'number' } }),
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('systemStock', 'number', { required: true, min: 0 }),
    f('countedStock', 'number', { min: 0 }),
    f('difference', 'number', { default: 0 }),
    f('note', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  // 收费组合（公有/私有，划价一键调出）
  crud('chargeCombos', 'ChargeCombo', [
    f('code', 'text', { required: true, unique: true, searchable: true }),
    f('name', 'text', { required: true, searchable: true }),
    f('type', 'enum', { required: true, enumValues: ['PUBLIC', 'PRIVATE'] }),
    f('ownerId', 'relation', { relation: { resource: 'users', foreignKey: 'ownerId', labelField: 'name' } }),
    f('active', 'boolean', { default: true }),
  ], { roles: boss, audit: true, capabilities: { list: true, create: true, update: true, delete: false, softDelete: false } }),

  crud('chargeComboItems', 'ChargeComboItem', [
    f('comboId', 'relation', { required: true, relation: { resource: 'chargeCombos', foreignKey: 'comboId', labelField: 'name' } }),
    f('catalogId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('category', 'text', { required: true }),
    f('price', 'money', { required: true }),
    f('quantity', 'number', { required: true, min: 1 }),
    f('costType', 'enum', { enumValues: ['SERVICE', 'MATERIAL'] }),
  ], { roles: boss, audit: true, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

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
  ], { roles: staff, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  crud('dispenseItems', 'DispenseItem', [
    f('dispenseId', 'relation', { required: true, relation: { resource: 'dispenses', foreignKey: 'dispenseId', labelField: 'number' } }),
    f('itemId', 'relation', { required: true, relation: { resource: 'inventoryItems', foreignKey: 'itemId', labelField: 'name' } }),
    f('batchId', 'text'),
    f('name', 'text', { required: true, searchable: true }),
    f('spec', 'text'),
    f('quantity', 'number', { required: true, min: 1 }),
    f('returnedQuantity', 'number', { default: 0, min: 0 }),
  ], { roles: staff, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

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
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

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
    f('role', 'enum', { required: true, enumValues: ['BOSS', 'ADMIN', 'DOCTOR'] }),
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

  // 角色权限树配置
  crud('rolePermissions', 'RolePermission', [
    f('role', 'enum', { required: true, enumValues: ['BOSS', 'ADMIN', 'DOCTOR'] }),
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
  ], { roles: boss }),

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
  ], { roles: boss, capabilities: { list: true, create: false, update: false, delete: false, softDelete: false } }),

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
