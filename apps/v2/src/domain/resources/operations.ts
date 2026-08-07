import type { ResourceDefinition } from '../contracts';
import { f, crud, boss, reception } from './shared';

/** operationsResources：17 个资源定义（见原 resources.ts 分组） */
export const operationsResources: ResourceDefinition[] = [
  crud('invoices', 'Invoice', [
    f('chargeId', 'relation', { required: true, relation: { resource: 'charges', foreignKey: 'chargeId', labelField: 'number' } }),
    f('patientId', 'relation', { required: true, relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } }),
    f('number', 'text', { required: true, unique: true, searchable: true }),
    f('amount', 'money', { required: true }),
    f('type', 'text', { required: true }),
    f('status', 'text', { required: true }),
    f('issuedAt', 'datetime'),
    f('remark', 'longText'),
  ], { roles: boss, capabilities: { list: true, create: true, update: false, delete: false, softDelete: false } }),

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

];
