import { Database } from 'better-sqlite3';

const SCHEMA_LOGGER = {
  warn: (msg: string, err?: unknown) => {
    console.warn(`[Schema] ${msg}`, err ? (err as Error)?.message || err : '');
  },
  error: (msg: string, err?: unknown) => {
    console.error(`[Schema] ${msg}`, err ? (err as Error)?.message || err : '');
  },
};

/** 索引创建失败信息 */
export interface IndexCreationFailure {
  name: string;
  table: string;
  error: string;
}

/** 收集本次 createIndexes 调用期间所有失败的索引 */
const indexFailures: IndexCreationFailure[] = [];

/**
 * 创建索引（如果不存在）。where 可选，用于创建部分索引（partial index）
 *
 * P1 修复：原先所有错误都用 warn 静默吞没，无法区分「索引已存在」与「列不存在/语法错误」等真实问题。
 * 现在区分两类错误：
 *  - "already exists" → 正常情况（CREATE INDEX IF NOT EXISTS 不应报此错，但兼容旧数据），info 级别
 *  - 其他错误 → error 级别 + 记入 indexFailures，便于上层聚合上报
 */
export const createIndexIfNotExists = (db: Database, name: string, table: string, columns: string, where?: string) => {
  try {
    const whereClause = where ? ` WHERE ${where}` : '';
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})${whereClause}`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // "already exists" 在使用 IF NOT EXISTS 时不应出现，但兼容部分边界场景
    if (errMsg.includes('already exists')) {
      SCHEMA_LOGGER.warn(`索引已存在（跳过）: ${name} ON ${table}`);
    } else {
      // 真实错误：列不存在、表不存在、语法错误等
      SCHEMA_LOGGER.error(`创建索引失败: ${name} ON ${table}(${columns})`, err);
      indexFailures.push({ name, table, error: errMsg });
    }
  }
};

/**
 * 获取累计的索引创建失败列表（主要用于诊断与上报）
 * 返回副本避免外部修改
 */
export function getIndexFailures(): IndexCreationFailure[] {
  return [...indexFailures];
}

export function createIndexes(db: Database) {
  createIndexIfNotExists(db, 'idx_clinic_code', 'Clinic', 'code');
  createIndexIfNotExists(db, 'idx_clinic_active', 'Clinic', 'isActive');
  createIndexIfNotExists(db, 'idx_user_clinic', 'User', 'clinicId');
  createIndexIfNotExists(db, 'idx_patient_clinic', 'Patient', 'clinicId');
  createIndexIfNotExists(db, 'idx_used_refresh_token_user', 'UsedRefreshToken', 'userId');
  createIndexIfNotExists(db, 'idx_patient_name', 'Patient', 'name');
  createIndexIfNotExists(db, 'idx_patient_phone', 'Patient', 'phone');
  createIndexIfNotExists(db, 'idx_patient_code', 'Patient', 'code');
  createIndexIfNotExists(db, 'idx_patient_source', 'Patient', 'source');
  createIndexIfNotExists(db, 'idx_appointment_doctor', 'Appointment', 'doctorId');
  createIndexIfNotExists(db, 'idx_appointment_patient', 'Appointment', 'patientId');
  createIndexIfNotExists(db, 'idx_appointment_start_time', 'Appointment', 'startTime');
  createIndexIfNotExists(db, 'idx_appointment_status', 'Appointment', 'status');
  createIndexIfNotExists(db, 'idx_visit_patient', 'Visit', 'patientId');
  createIndexIfNotExists(db, 'idx_visit_doctor', 'Visit', 'doctorId');
  createIndexIfNotExists(db, 'idx_visit_status', 'Visit', 'status');
  createIndexIfNotExists(db, 'idx_treatment_patient', 'Treatment', 'patientId');
  createIndexIfNotExists(db, 'idx_treatment_visit', 'Treatment', 'visitId');
  createIndexIfNotExists(db, 'idx_treatment_status', 'Treatment', 'status');
  createIndexIfNotExists(db, 'idx_charge_patient', 'Charge', 'patientId');
  createIndexIfNotExists(db, 'idx_charge_status', 'Charge', 'status');
  createIndexIfNotExists(db, 'idx_charge_visit', 'Charge', 'visitId');
  createIndexIfNotExists(db, 'idx_prescription_patient', 'Prescription', 'patientId');
  createIndexIfNotExists(db, 'idx_prescription_visit', 'Prescription', 'visitId');
  createIndexIfNotExists(db, 'idx_imaging_patient', 'Imaging', 'patientId');
  createIndexIfNotExists(db, 'idx_imaging_visit', 'Imaging', 'visitId');
  createIndexIfNotExists(db, 'idx_followup_patient', 'FollowUp', 'patientId');
  createIndexIfNotExists(db, 'idx_followup_status', 'FollowUp', 'status');
  createIndexIfNotExists(db, 'idx_followup_plan_date', 'FollowUp', 'planDate');
  createIndexIfNotExists(db, 'idx_followuptemplate_clinic', 'FollowUpTemplate', 'clinicId');
  createIndexIfNotExists(db, 'idx_followupitem_clinic', 'FollowUpItem', 'clinicId');
  createIndexIfNotExists(db, 'idx_followupresult_clinic', 'FollowUpResult', 'clinicId');
  createIndexIfNotExists(db, 'idx_member_card_patient', 'MemberCard', 'patientId');
  createIndexIfNotExists(db, 'idx_member_card_status', 'MemberCard', 'status');
  createIndexIfNotExists(db, 'idx_inventory_item_code', 'InventoryItem', 'code');
  createIndexIfNotExists(db, 'idx_inventory_item_category', 'InventoryItem', 'category');
  createIndexIfNotExists(db, 'idx_inventory_item_supplier', 'InventoryItem', 'supplierId');
  createIndexIfNotExists(db, 'idx_supplier_name', 'Supplier', 'name');
  createIndexIfNotExists(db, 'idx_equipment_name', 'Equipment', 'name');
  createIndexIfNotExists(db, 'idx_equipment_category', 'Equipment', 'category');
  createIndexIfNotExists(db, 'idx_equipment_status', 'Equipment', 'status');
  createIndexIfNotExists(db, 'idx_registration_patient', 'Registration', 'patientId');
  createIndexIfNotExists(db, 'idx_registration_status', 'Registration', 'status');
  createIndexIfNotExists(db, 'idx_medical_record_patient', 'MedicalRecord', 'patientId');
  createIndexIfNotExists(db, 'idx_medical_record_visit', 'MedicalRecord', 'visitId');
  createIndexIfNotExists(db, 'idx_tooth_record_patient', 'ToothRecord', 'patientId');
  createIndexIfNotExists(db, 'idx_purchase_order_supplier', 'PurchaseOrder', 'supplierId');
  createIndexIfNotExists(db, 'idx_purchase_order_status', 'PurchaseOrder', 'status');
  createIndexIfNotExists(db, 'idx_processing_order_patient', 'ProcessingOrder', 'patientId');
  createIndexIfNotExists(db, 'idx_processing_order_factory', 'ProcessingOrder', 'factoryId');
  createIndexIfNotExists(db, 'idx_processing_order_status', 'ProcessingOrder', 'status');
  createIndexIfNotExists(db, 'idx_user_username', 'User', 'username');
  createIndexIfNotExists(db, 'idx_user_role', 'User', 'role');
  createIndexIfNotExists(db, 'idx_operation_log_user', 'OperationLog', 'userId');
  createIndexIfNotExists(db, 'idx_operation_log_created', 'OperationLog', 'createdAt');
  createIndexIfNotExists(db, 'idx_chair_active', 'Chair', 'active');
  createIndexIfNotExists(db, 'idx_first_exam_patient', 'FirstExam', 'patientId');
  createIndexIfNotExists(db, 'idx_first_exam_status', 'FirstExam', 'status');
  createIndexIfNotExists(db, 'idx_first_exam_tooth_exam', 'FirstExamTooth', 'examId');
  createIndexIfNotExists(db, 'idx_first_exam_track_exam', 'FirstExamTrack', 'examId');
  createIndexIfNotExists(db, 'idx_first_exam_track_patient', 'FirstExamTrack', 'patientId');
  createIndexIfNotExists(db, 'idx_membercardlog_charge_clinic', 'MemberCardLog', 'chargeId, clinicId');
  createIndexIfNotExists(db, 'idx_followup_assignee_clinic', 'FollowUp', 'assigneeId, clinicId');
  createIndexIfNotExists(db, 'idx_oral_exam_patient', 'OralExamination', 'patientId');
  createIndexIfNotExists(db, 'idx_periodontal_patient', 'PeriodontalRecord', 'patientId');
  createIndexIfNotExists(db, 'idx_treatment_plan_patient', 'TreatmentPlan', 'patientId');
  createIndexIfNotExists(db, 'idx_treatment_plan_status', 'TreatmentPlan', 'status');
  createIndexIfNotExists(db, 'idx_charge_item_order', 'ChargeItem', 'chargeId');
  createIndexIfNotExists(db, 'idx_treatment_plan_item_plan', 'TreatmentPlanItem', 'planId');
  createIndexIfNotExists(db, 'idx_prescription_item_prescription', 'PrescriptionItem', 'prescriptionId');
  createIndexIfNotExists(db, 'idx_purchase_order_item_order', 'PurchaseOrderItem', 'orderId');
  createIndexIfNotExists(db, 'idx_processing_order_item_order', 'ProcessingOrderItem', 'orderId');
  createIndexIfNotExists(db, 'idx_processing_flow_log_order', 'ProcessingFlowLog', 'orderId');
  createIndexIfNotExists(db, 'idx_member_card_log_card', 'MemberCardLog', 'cardId');
  createIndexIfNotExists(db, 'idx_membercardlog_charge', 'MemberCardLog', 'chargeId');
  createIndexIfNotExists(db, 'idx_inventory_transaction_item', 'InventoryTransaction', 'itemId');
  createIndexIfNotExists(db, 'idx_wechat_message_patient', 'WechatMessage', 'patientId');
  createIndexIfNotExists(db, 'idx_refund_charge', 'Refund', 'chargeId');
  createIndexIfNotExists(db, 'idx_debt_patient', 'DebtRecord', 'patientId');
  createIndexIfNotExists(db, 'idx_debt_status', 'DebtRecord', 'status');
  createIndexIfNotExists(db, 'idx_debt_charge', 'DebtRecord', 'chargeId');
  createIndexIfNotExists(db, 'idx_debt_created', 'DebtRecord', 'createdAt');
  // P0.4: DebtRecord.chargeId 唯一索引（防止同一收费单产生重复欠费记录）
  // P1 修复：原先 try-catch 完全静默吞没错误（连日志都没有），
  // 唯一索引创建失败可能暗示数据已存在重复（数据损坏），必须 error 级别告警
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('UNIQUE constraint failed')) {
      // 数据层已存在重复 chargeId — 这是数据损坏信号，必须 error 告警
      SCHEMA_LOGGER.error('创建 idx_debt_charge_unique 失败：DebtRecord 表存在重复 chargeId，需手动清理重复数据', err);
    } else {
      SCHEMA_LOGGER.error('创建唯一索引 idx_debt_charge_unique 失败', err);
    }
    indexFailures.push({ name: 'idx_debt_charge_unique', table: 'DebtRecord', error: errMsg });
  }
  createIndexIfNotExists(db, 'idx_idempotency_key', 'IdempotencyRecord', 'key');
  createIndexIfNotExists(db, 'idx_idempotency_expires', 'IdempotencyRecord', 'expiresAt');

  createIndexIfNotExists(db, 'idx_appointment_doctor_start', 'Appointment', 'doctorId, startTime');
  createIndexIfNotExists(db, 'idx_appointment_start_status', 'Appointment', 'startTime, status');
  createIndexIfNotExists(db, 'idx_charge_paid_at_status', 'Charge', 'paidAt, status');
  createIndexIfNotExists(db, 'idx_charge_doctor_paid', 'Charge', 'doctorId, paidAt');
  createIndexIfNotExists(db, 'idx_treatment_doctor_completed', 'Treatment', 'doctorId, completedDate');
  createIndexIfNotExists(db, 'idx_patient_created', 'Patient', 'createdAt');
  createIndexIfNotExists(db, 'idx_visit_doctor_start', 'Visit', 'doctorId, startTime');

  createIndexIfNotExists(db, 'idx_member_card_status_balance', 'MemberCard', 'status, balance');
  createIndexIfNotExists(db, 'idx_registration_doctor_status', 'Registration', 'doctorId, status');
  createIndexIfNotExists(db, 'idx_registration_status_registered', 'Registration', 'status, registeredAt');
  createIndexIfNotExists(db, 'idx_medical_record_doctor_created', 'MedicalRecord', 'doctorId, createdAt');
  createIndexIfNotExists(db, 'idx_first_exam_doctor_date', 'FirstExam', 'doctorId, examDate');
  createIndexIfNotExists(db, 'idx_followup_status_date', 'FollowUp', 'status, planDate');

  // W1-3: 复合索引（clinicId 前缀，优化多租户查询性能）
  // 高频查询表：clinicId + 常用过滤字段
  createIndexIfNotExists(db, 'idx_charge_clinic_number', 'Charge', 'clinicId, number');
  createIndexIfNotExists(db, 'idx_charge_clinic_status', 'Charge', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_charge_clinic_paidat', 'Charge', 'clinicId, paidAt');
  createIndexIfNotExists(db, 'idx_charge_clinic_patient', 'Charge', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_appointment_clinic_start', 'Appointment', 'clinicId, startTime');
  createIndexIfNotExists(db, 'idx_appointment_clinic_status', 'Appointment', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_appointment_clinic_doctor', 'Appointment', 'clinicId, doctorId');
  createIndexIfNotExists(db, 'idx_patient_clinic_created', 'Patient', 'clinicId, createdAt');
  createIndexIfNotExists(db, 'idx_patient_clinic_name', 'Patient', 'clinicId, name');
  createIndexIfNotExists(db, 'idx_debt_clinic_status', 'DebtRecord', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_debt_clinic_patient', 'DebtRecord', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_operation_log_clinic_created', 'OperationLog', 'clinicId, createdAt');
  createIndexIfNotExists(db, 'idx_registration_clinic_status', 'Registration', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_medical_record_clinic_patient', 'MedicalRecord', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_purchase_order_clinic_status', 'PurchaseOrder', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_processing_order_clinic_status', 'ProcessingOrder', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_refund_clinic_charge', 'Refund', 'clinicId, chargeId');
  createIndexIfNotExists(db, 'idx_member_card_clinic_patient', 'MemberCard', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_inventory_item_clinic_category', 'InventoryItem', 'clinicId, category');
  createIndexIfNotExists(db, 'idx_prescription_clinic_patient', 'Prescription', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_visit_clinic_patient', 'Visit', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_treatment_clinic_patient', 'Treatment', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_treatment_plan_clinic_patient', 'TreatmentPlan', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_imaging_clinic_patient', 'Imaging', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_followup_clinic_status', 'FollowUp', 'clinicId, status');
  createIndexIfNotExists(db, 'idx_followup_clinic_patient', 'FollowUp', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_tooth_record_clinic_patient', 'ToothRecord', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_first_exam_clinic_patient', 'FirstExam', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_oral_exam_clinic_patient', 'OralExamination', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_periodontal_clinic_patient', 'PeriodontalRecord', 'clinicId, patientId');
  createIndexIfNotExists(db, 'idx_wechat_message_clinic_patient', 'WechatMessage', 'clinicId, patientId');

  // P1-3: 补充索引（v10 迁移新增）
  createIndexIfNotExists(db, 'idx_clinicinfo_clinic', 'ClinicInfo', 'clinicId');
  createIndexIfNotExists(db, 'idx_used_refresh_token_usedat', 'UsedRefreshToken', 'usedAt');
  createIndexIfNotExists(db, 'idx_backup_record_clinic', 'BackupRecord', 'clinicId');

  // 4.3: 高频查询复合索引（clinicId + deletedAt + createdAt），优化多租户分页列表查询
  createIndexIfNotExists(db, 'idx_charge_clinic_deleted_created', 'Charge', 'clinicId, deletedAt, createdAt');
  createIndexIfNotExists(db, 'idx_refund_clinic_deleted_created', 'Refund', 'clinicId, deletedAt, createdAt');
  createIndexIfNotExists(db, 'idx_debtrecord_clinic_deleted_created', 'DebtRecord', 'clinicId, deletedAt, createdAt');
  createIndexIfNotExists(db, 'idx_patient_clinic_deleted_created', 'Patient', 'clinicId, deletedAt, createdAt');
  createIndexIfNotExists(db, 'idx_membercard_clinic_deleted_created', 'MemberCard', 'clinicId, deletedAt, createdAt');
  createIndexIfNotExists(db, 'idx_inventoryitem_clinic_deleted_created', 'InventoryItem', 'clinicId, deletedAt, createdAt');
  createIndexIfNotExists(db, 'idx_medicalrecord_clinic_deleted_created', 'MedicalRecord', 'clinicId, deletedAt, createdAt');

  // v22: 患者搜索优化索引（前缀匹配可利用复合索引，clinicId 前缀 + 搜索字段）
  createIndexIfNotExists(db, 'idx_patient_clinic_phone', 'Patient', 'clinicId, phone');
  createIndexIfNotExists(db, 'idx_patient_clinic_code', 'Patient', 'clinicId, code');

  // stats.service.ts 聚合查询优化：部分索引（WHERE deletedAt IS NULL），减小索引体积
  // Charge: paidAt 范围 + clinicId 过滤（dashboard 今日/本月收费、revenue/chargeStats 分组）
  createIndexIfNotExists(db, 'idx_charge_paidat_clinic', 'Charge', 'paidAt, clinicId', 'deletedAt IS NULL');
  // Charge: status != 'PAID' 未付单查询
  createIndexIfNotExists(db, 'idx_charge_status_clinic', 'Charge', 'status, clinicId', 'deletedAt IS NULL');
  // Appointment: startTime 范围 + clinicId 过滤（dashboard 今日预约、appointmentStats 分组）
  createIndexIfNotExists(db, 'idx_appointment_starttime_clinic', 'Appointment', 'startTime, clinicId', 'deletedAt IS NULL');
  // Visit: startTime 范围 + clinicId 过滤（dashboard 今日就诊）
  createIndexIfNotExists(db, 'idx_visit_starttime_clinic', 'Visit', 'startTime, clinicId', 'deletedAt IS NULL');
  // Treatment: doctorId + clinicId（doctorWorkload 按医生分组聚合）
  createIndexIfNotExists(db, 'idx_treatment_doctorid_clinic', 'Treatment', 'doctorId, clinicId', 'deletedAt IS NULL');
  // MemberCard: status = 'ACTIVE' + clinicId（memberStats 活跃会员统计）
  createIndexIfNotExists(db, 'idx_membercard_status_clinic', 'MemberCard', 'status, clinicId', 'deletedAt IS NULL');

  // v19: 补充索引
  // AuditLog 表
  createIndexIfNotExists(db, 'idx_audit_target', 'AuditLog', 'targetType, targetId, createdAt DESC');
  createIndexIfNotExists(db, 'idx_audit_operator', 'AuditLog', 'operatorId, createdAt DESC');
  createIndexIfNotExists(db, 'idx_audit_clinic_created', 'AuditLog', 'clinicId, createdAt DESC');

  // RecordModifyRequest 表
  createIndexIfNotExists(db, 'idx_record_modify_status', 'RecordModifyRequest', 'status, clinicId');
  createIndexIfNotExists(db, 'idx_record_modify_record', 'RecordModifyRequest', 'recordId, clinicId');

  // MemberCardLog 表
  createIndexIfNotExists(db, 'idx_membercardlog_card_created', 'MemberCardLog', 'cardId, createdAt DESC');

  // MemberPointLog 表
  createIndexIfNotExists(db, 'idx_memberpointlog_card_created', 'MemberPointLog', 'cardId, createdAt DESC');

  // InventoryTransaction 表
  createIndexIfNotExists(db, 'idx_inv_trans_item_created', 'InventoryTransaction', 'itemId, createdAt DESC');
  createIndexIfNotExists(db, 'idx_inv_trans_type_created', 'InventoryTransaction', 'type, createdAt DESC');
  createIndexIfNotExists(db, 'idx_inv_trans_clinic_created', 'InventoryTransaction', 'clinicId, createdAt DESC');

  // BackupRecord 表
  createIndexIfNotExists(db, 'idx_backup_clinic_created', 'BackupRecord', 'clinicId, createdAt DESC');

  // SystemAlert 表
  createIndexIfNotExists(db, 'idx_system_alert_clinic_created', 'SystemAlert', 'clinicId, createdAt DESC');
  createIndexIfNotExists(db, 'idx_system_alert_level', 'SystemAlert', 'level, createdAt DESC');
  createIndexIfNotExists(db, 'idx_system_alert_resolved', 'SystemAlert', 'resolved, createdAt DESC');

  // 性能优化：补充缺失索引（WHERE 子句中高频查询字段无索引）
  // ProcessingProduct: factoryId 过滤（processing-orders.service.ts listProductsByFactory）
  createIndexIfNotExists(db, 'idx_processing_product_factory', 'ProcessingProduct', 'factoryId');
  createIndexIfNotExists(db, 'idx_processing_product_clinic', 'ProcessingProduct', 'clinicId');
  // ProcessingFactory: clinicId 过滤（多租户列表查询）
  createIndexIfNotExists(db, 'idx_processing_factory_clinic', 'ProcessingFactory', 'clinicId');
  // MedicalRecordPhrase: clinicId + category 过滤（medical-records.service.ts listPhrases）
  createIndexIfNotExists(db, 'idx_medical_record_phrase_clinic', 'MedicalRecordPhrase', 'clinicId');
  createIndexIfNotExists(db, 'idx_medical_record_phrase_category', 'MedicalRecordPhrase', 'category');
  // AutoFollowUpRule: clinicId 过滤（follow-ups.service.ts listAutoRules）
  createIndexIfNotExists(db, 'idx_auto_followup_rule_clinic', 'AutoFollowUpRule', 'clinicId');
  // FirstExamTooth: 复合索引（examId + toothNumber），优化 updateTooth 的 upsert 查询
  createIndexIfNotExists(db, 'idx_first_exam_tooth_exam_tooth', 'FirstExamTooth', 'examId, toothNumber');
  // FollowUpItem: templateId 过滤（follow-ups.service.ts listItems）
  createIndexIfNotExists(db, 'idx_followup_item_template', 'FollowUpItem', 'templateId');
  // FirstExamFollowUp: examId 过滤（first-exams.service.ts createFollowUp 校验）
  createIndexIfNotExists(db, 'idx_first_exam_followup_exam', 'FirstExamFollowUp', 'examId');
  // ProcessingFlowLog: orderId 排序查询补充 clinicId 复合索引
  createIndexIfNotExists(db, 'idx_processing_flow_log_clinic_order', 'ProcessingFlowLog', 'clinicId, orderId');

  // 性能优化：补充高频查询字段索引
  // OperationLog: action 过滤（操作日志按类型查询）
  createIndexIfNotExists(db, 'idx_operation_log_action', 'OperationLog', 'action');
  // OperationLog: target 过滤（操作日志按目标查询）
  createIndexIfNotExists(db, 'idx_operation_log_target', 'OperationLog', 'target');
  // Refund: patientId 过滤（退款记录按患者查询）
  createIndexIfNotExists(db, 'idx_refund_patient', 'Refund', 'patientId');
  // Refund: createdAt 排序（退款记录按时间排序）
  createIndexIfNotExists(db, 'idx_refund_created', 'Refund', 'createdAt');
  // ChargeItem: inventoryItemId 过滤（收费项目按库存项目查询）
  createIndexIfNotExists(db, 'idx_charge_item_inventory', 'ChargeItem', 'inventoryItemId');
  // ChargeItem: treatmentId 过滤（收费项目按治疗项目查询）
  createIndexIfNotExists(db, 'idx_charge_item_treatment', 'ChargeItem', 'treatmentId');
  // Appointment: clinicId + patientId 复合索引（按诊所+患者查询预约）
  createIndexIfNotExists(db, 'idx_appointment_clinic_patient', 'Appointment', 'clinicId, patientId');

  // Notification 表索引
  createIndexIfNotExists(db, 'idx_notification_clinic', 'Notification', 'clinicId');
  createIndexIfNotExists(db, 'idx_notification_user', 'Notification', 'userId');
  createIndexIfNotExists(db, 'idx_notification_type', 'Notification', 'type');
  createIndexIfNotExists(db, 'idx_notification_priority', 'Notification', 'priority');
  createIndexIfNotExists(db, 'idx_notification_read', 'Notification', 'readAt');
  createIndexIfNotExists(db, 'idx_notification_created', 'Notification', 'createdAt DESC');
  createIndexIfNotExists(db, 'idx_notification_clinic_user_created', 'Notification', 'clinicId, userId, createdAt DESC');
  createIndexIfNotExists(db, 'idx_notification_clinic_user_read', 'Notification', 'clinicId, userId, readAt');
  createIndexIfNotExists(db, 'idx_notification_clinic_deleted_created', 'Notification', 'clinicId, deletedAt, createdAt DESC');

  // 性能优化：补充缺失索引（N+1 查询优化后的批量查询所需）
  // User: clinicId + active + id 复合索引，优化医生批量查询（appointments/treatments/medical-records/charge）
  createIndexIfNotExists(db, 'idx_user_clinic_active', 'User', 'clinicId, active, id');
  // Patient: clinicId + deletedAt + id 复合索引，优化患者批量查询
  createIndexIfNotExists(db, 'idx_patient_clinic_deleted_id', 'Patient', 'clinicId, deletedAt, id');
  // Charge: clinicId + deletedAt + doctorId 复合索引，优化收费记录按医生查询
  createIndexIfNotExists(db, 'idx_charge_clinic_deleted_doctor', 'Charge', 'clinicId, deletedAt, doctorId');
  // Treatment: clinicId + deletedAt + doctorId 复合索引，优化治疗记录按医生查询
  createIndexIfNotExists(db, 'idx_treatment_clinic_deleted_doctor', 'Treatment', 'clinicId, deletedAt, doctorId');
  // MedicalRecord: clinicId + deletedAt + doctorId 复合索引，优化病历按医生查询
  createIndexIfNotExists(db, 'idx_medical_record_clinic_deleted_doctor', 'MedicalRecord', 'clinicId, deletedAt, doctorId');
  // Appointment: clinicId + deletedAt + patientId 复合索引，优化预约按患者查询
  createIndexIfNotExists(db, 'idx_appointment_clinic_deleted_patient', 'Appointment', 'clinicId, deletedAt, patientId');

  // v23: 慢查询优化 — 复合索引补充
  // ChargeItem: chargeId + category 复合索引，优化 revenue-stats 按分类收入统计的 JOIN + GROUP BY
  createIndexIfNotExists(db, 'idx_charge_item_charge_category', 'ChargeItem', 'chargeId, category');
  // Charge: clinicId + status + createdAt DESC 部分索引，优化 charge.service.ts 按状态分页列表及 dashboard 待收费查询
  createIndexIfNotExists(db, 'idx_charge_clinic_status_created', 'Charge', 'clinicId, status, createdAt DESC', 'deletedAt IS NULL');
  // Charge: clinicId + patientId + createdAt DESC 部分索引，优化患者收费历史分页查询
  createIndexIfNotExists(db, 'idx_charge_clinic_patient_created', 'Charge', 'clinicId, patientId, createdAt DESC', 'deletedAt IS NULL');
  // Charge: clinicId + paidAt + doctorId 部分索引，优化 revenue-stats 按医生收入统计的日期范围 + 分组查询
  createIndexIfNotExists(db, 'idx_charge_clinic_paidat_doctor', 'Charge', 'clinicId, paidAt, doctorId', 'deletedAt IS NULL');
  // Patient: clinicId + name + phone 复合索引，优化患者搜索的覆盖索引扫描（减少回表）
  createIndexIfNotExists(db, 'idx_patient_clinic_name_phone', 'Patient', 'clinicId, name, phone', 'deletedAt IS NULL');

  // DrugCatalog: clinicId + code 复合索引，优化药品目录分页查询
  createIndexIfNotExists(db, 'idx_drugcatalog_clinic_code', 'DrugCatalog', 'clinicId, code');

  // v24: 补充缺失的 clinicId 索引（含 clinicId 列但无索引的表）
  // ChargeCombo: clinicId + deletedAt + createdAt 复合索引，优化 combo 分页列表查询
  createIndexIfNotExists(db, 'idx_charge_combo_clinic_deleted_created', 'ChargeCombo', 'clinicId, deletedAt, createdAt');
  // ChargeComboItem: clinicId + comboId 复合索引，优化组合项目查询
  createIndexIfNotExists(db, 'idx_charge_combo_item_clinic_combo', 'ChargeComboItem', 'clinicId, comboId');
  // PaymentMethod: clinicId 索引，优化支付方式多租户查询
  createIndexIfNotExists(db, 'idx_payment_method_clinic', 'PaymentMethod', 'clinicId');
  // TreatmentCatalog: clinicId + deletedAt + code 复合索引，优化治疗目录分页查询
  createIndexIfNotExists(db, 'idx_treatment_catalog_clinic_deleted_code', 'TreatmentCatalog', 'clinicId, deletedAt, code');
  // MedicalRecordTemplate: clinicId + deletedAt + category 复合索引，优化病历模板列表查询
  createIndexIfNotExists(db, 'idx_medical_record_template_clinic_deleted', 'MedicalRecordTemplate', 'clinicId, deletedAt, category');
  // Supplier: clinicId + deletedAt + name 复合索引，优化供应商多租户查询
  createIndexIfNotExists(db, 'idx_supplier_clinic_deleted', 'Supplier', 'clinicId, deletedAt, name');
  // PurchaseOrderItem: clinicId + orderId 复合索引，优化采购订单明细查询
  createIndexIfNotExists(db, 'idx_purchase_order_item_clinic_order', 'PurchaseOrderItem', 'clinicId, orderId');
  // ProcessingOrderItem: clinicId + orderId 复合索引，优化加工订单明细查询
  createIndexIfNotExists(db, 'idx_processing_order_item_clinic_order', 'ProcessingOrderItem', 'clinicId, orderId');
  // Family: clinicId 索引，优化家庭组多租户查询
  createIndexIfNotExists(db, 'idx_family_clinic', 'Family', 'clinicId');
  // PrescriptionItem: clinicId + prescriptionId 复合索引，优化处方明细查询
  createIndexIfNotExists(db, 'idx_prescription_item_clinic_prescription', 'PrescriptionItem', 'clinicId, prescriptionId');
  // FirstExamFollowUp: clinicId + examId 复合索引，优化初诊回访查询
  createIndexIfNotExists(db, 'idx_first_exam_followup_clinic_exam', 'FirstExamFollowUp', 'clinicId, examId');
  // FirstExamTooth: clinicId + examId 复合索引，优化初诊牙位查询（已有 examId 单列索引）
  createIndexIfNotExists(db, 'idx_first_exam_tooth_clinic_exam', 'FirstExamTooth', 'clinicId, examId');

  // v29: 关键业务表软删除查询优化复合索引 (clinicId, deletedAt, createdAt/startTime DESC)
  createIndexIfNotExists(db, 'idx_patient_clinic_deleted_created', 'Patient', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_appointment_clinic_deleted_start', 'Appointment', 'clinicId, deletedAt, startTime DESC');
  createIndexIfNotExists(db, 'idx_charge_clinic_deleted_created', 'Charge', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_treatment_clinic_deleted_created', 'Treatment', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_medical_record_clinic_deleted_created', 'MedicalRecord', 'clinicId, deletedAt, createdAt DESC');

  // v31: 艾登特 12 张新表索引
  // CephalometricLandmarkSet
  createIndexIfNotExists(db, 'idx_cephalolandmarkset_clinic_deleted', 'CephalometricLandmarkSet', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_cephalolandmarkset_patient', 'CephalometricLandmarkSet', 'patientId, deletedAt');
  createIndexIfNotExists(db, 'idx_cephalolandmarkset_image', 'CephalometricLandmarkSet', 'imageId, deletedAt');
  // CephalometricAnalysisRecord
  createIndexIfNotExists(db, 'idx_cephalorecord_clinic_deleted', 'CephalometricAnalysisRecord', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_cephalorecord_landmarkset', 'CephalometricAnalysisRecord', 'landmarkSetId, deletedAt');
  createIndexIfNotExists(db, 'idx_cephalorecord_doctor', 'CephalometricAnalysisRecord', 'doctorId, deletedAt');
  createIndexIfNotExists(db, 'idx_cephalorecord_method', 'CephalometricAnalysisRecord', 'method, deletedAt');
  // CephalometricNormValue
  createIndexIfNotExists(db, 'idx_cephalonorm_clinic_deleted', 'CephalometricNormValue', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_cephalonorm_method_metric', 'CephalometricNormValue', 'method, metricName, deletedAt');
  createIndexIfNotExists(db, 'idx_cephalonorm_race_gender_age', 'CephalometricNormValue', 'race, gender, ageMin, ageMax, deletedAt');
  // DrugContraindication
  createIndexIfNotExists(db, 'idx_drugcontra_clinic_deleted', 'DrugContraindication', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_drugcontra_drugA', 'DrugContraindication', 'drugAId, deletedAt');
  createIndexIfNotExists(db, 'idx_drugcontra_drugB', 'DrugContraindication', 'drugBId, deletedAt');
  createIndexIfNotExists(db, 'idx_drugcontra_categoryA', 'DrugContraindication', 'drugCategoryA, deletedAt');
  createIndexIfNotExists(db, 'idx_drugcontra_categoryB', 'DrugContraindication', 'drugCategoryB, deletedAt');
  createIndexIfNotExists(db, 'idx_drugcontra_severity', 'DrugContraindication', 'severity, deletedAt');
  // PatientRiskScore
  createIndexIfNotExists(db, 'idx_patientrisk_clinic_deleted', 'PatientRiskScore', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_patientrisk_patient', 'PatientRiskScore', 'patientId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_patientrisk_assessed', 'PatientRiskScore', 'assessedById, deletedAt');
  createIndexIfNotExists(db, 'idx_patientrisk_carieslevel', 'PatientRiskScore', 'cariesLevel, deletedAt');
  createIndexIfNotExists(db, 'idx_patientrisk_periodontallevel', 'PatientRiskScore', 'periodontalLevel, deletedAt');
  createIndexIfNotExists(db, 'idx_patientrisk_implantlevel', 'PatientRiskScore', 'implantLevel, deletedAt');
  // BusinessAlert
  createIndexIfNotExists(db, 'idx_bizalert_clinic_deleted', 'BusinessAlert', 'clinicId, deletedAt, occurredAt DESC');
  createIndexIfNotExists(db, 'idx_bizalert_type_severity', 'BusinessAlert', 'alertType, severity, deletedAt, occurredAt DESC');
  createIndexIfNotExists(db, 'idx_bizalert_acknowledged', 'BusinessAlert', 'acknowledged, deletedAt, occurredAt DESC');
  createIndexIfNotExists(db, 'idx_bizalert_metricname', 'BusinessAlert', 'metricName, deletedAt, occurredAt DESC');
  // InventoryReplenishmentSuggestion
  createIndexIfNotExists(db, 'idx_invreplenish_clinic_deleted', 'InventoryReplenishmentSuggestion', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_invreplenish_inventory', 'InventoryReplenishmentSuggestion', 'inventoryId, deletedAt, createdAt DESC');
  // SatisfactionSurvey
  createIndexIfNotExists(db, 'idx_satisfaction_clinic_deleted', 'SatisfactionSurvey', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_satisfaction_patient', 'SatisfactionSurvey', 'patientId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_satisfaction_doctor', 'SatisfactionSurvey', 'doctorId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_satisfaction_overallstars', 'SatisfactionSurvey', 'overallStars, deletedAt, createdAt DESC');
  // StaffSchedule
  createIndexIfNotExists(db, 'idx_staffsched_clinic_deleted', 'StaffSchedule', 'clinicId, deletedAt, scheduleDate DESC');
  createIndexIfNotExists(db, 'idx_staffsched_staff_date', 'StaffSchedule', 'staffId, deletedAt, scheduleDate');
  createIndexIfNotExists(db, 'idx_staffsched_scheduledate', 'StaffSchedule', 'scheduleDate, deletedAt');
  createIndexIfNotExists(db, 'idx_staffsched_shift', 'StaffSchedule', 'shiftId, deletedAt');
  // StaffLeaveRequest
  createIndexIfNotExists(db, 'idx_staffleave_clinic_deleted', 'StaffLeaveRequest', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_staffleave_staff_status', 'StaffLeaveRequest', 'staffId, deletedAt, status, startDate');
  createIndexIfNotExists(db, 'idx_staffleave_approver', 'StaffLeaveRequest', 'approverId, deletedAt, status');
  createIndexIfNotExists(db, 'idx_staffleave_leavetype', 'StaffLeaveRequest', 'leaveType, deletedAt');
  createIndexIfNotExists(db, 'idx_staffleave_dates', 'StaffLeaveRequest', 'startDate, endDate, deletedAt');
  // DataImportJob
  createIndexIfNotExists(db, 'idx_dataimport_clinic_deleted', 'DataImportJob', 'clinicId, deletedAt, createdAt DESC');
  createIndexIfNotExists(db, 'idx_dataimport_type_status', 'DataImportJob', 'importType, deletedAt, status, createdAt DESC');
  createIndexIfNotExists(db, 'idx_dataimport_startedby', 'DataImportJob', 'startedById, deletedAt, createdAt DESC');

  // v41: ChargeAssistant - 关联规则与忽略表
  createIndexIfNotExists(db, 'IDX_ChargeAssociationRule_clinic_antecedent_cons',
    'ChargeAssociationRule', 'clinicId, antecedent, consequent');
  createIndexIfNotExists(db, 'IDX_ChargeAssociationRule_clinic_confidence',
    'ChargeAssociationRule', 'clinicId, antecedentSize, confidence, lift');
  createIndexIfNotExists(db, 'IDX_ChargeAssociationIgnore_clinic',
    'ChargeAssociationIgnore', 'clinicId, antecedent, consequent');

  // v43: Analytics - RFM 分层与医生业绩异常
  createIndexIfNotExists(db, 'IDX_PatientRfmScore_clinic_segment',
    'PatientRfmScore', 'clinicId, segment');
  createIndexIfNotExists(db, 'IDX_DoctorPerfAnomaly_clinic_severity',
    'DoctorPerformanceAnomaly', 'clinicId, severity, resolvedAt');
}
