import { Database } from 'better-sqlite3';

const SCHEMA_LOGGER = {
  warn: (msg: string, err?: unknown) => {
    console.warn(`[Schema] ${msg}`, err ? (err as Error)?.message || err : '');
  },
};

/** 创建索引（如果不存在）。where 可选，用于创建部分索引（partial index） */
export const createIndexIfNotExists = (db: Database, name: string, table: string, columns: string, where?: string) => {
  try {
    const whereClause = where ? ` WHERE ${where}` : '';
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})${whereClause}`);
  } catch (err: unknown) {
    SCHEMA_LOGGER.warn(`创建索引失败: ${name} ON ${table}`, err);
  }
};

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
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)');
  } catch {
    // 索引可能已存在，静默忽略
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
}
