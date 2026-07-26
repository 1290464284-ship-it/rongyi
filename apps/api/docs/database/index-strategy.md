# 索引设计文档

## 1. 索引设计原则

### 1.1 设计目标

- **查询性能优先**：为高频查询字段建立索引，减少全表扫描
- **多租户优化**：所有业务表的索引以 `clinicId` 为前缀，优化多租户查询
- **复合索引**：优先使用复合索引，覆盖常用查询条件
- **部分索引**：针对特定查询场景使用部分索引，减小索引体积
- **写读平衡**：避免过度索引，平衡写入性能和查询性能

### 1.2 索引类型

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| 单列索引 | 基于单个字段的索引 | 单一字段查询、排序 |
| 复合索引 | 基于多个字段的索引 | 多条件组合查询 |
| 唯一索引 | 保证字段唯一性的索引 | 业务编码、唯一约束 |
| 部分索引 | 带 WHERE 条件的索引 | 只索引部分数据，减小体积 |

### 1.3 命名规范

- 前缀：`idx_`
- 表名（小写，下划线分隔）
- 字段名（多个字段用下划线连接）
- 示例：`idx_patient_clinic_name` → Patient 表的 (clinicId, name) 索引

---

## 2. 索引清单

### 2.1 系统表索引

#### Clinic 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_clinic_code | code | 单列 | 诊所编码查询 |
| idx_clinic_active | isActive | 单列 | 活跃诊所筛选 |

#### User 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_user_clinic | clinicId | 单列 | 多租户查询 |
| idx_user_username | username | 单列 | 用户名登录查询 |
| idx_user_role | role | 单列 | 按角色筛选 |

#### AuditLog 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_audit_target | targetType, targetId, createdAt DESC | 复合 | 按目标对象查询操作历史 |
| idx_audit_operator | operatorId, createdAt DESC | 复合 | 按操作人查询操作历史 |
| idx_audit_clinic_created | clinicId, createdAt DESC | 复合 | 按诊所查询审计日志 |

#### OperationLog 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_operation_log_user | userId | 单列 | 按用户查询操作日志 |
| idx_operation_log_created | createdAt | 单列 | 按时间排序 |
| idx_operation_log_clinic_created | clinicId, createdAt | 复合 | 多租户操作日志查询 |
| idx_operation_log_action | action | 单列 | 按操作类型筛选 |
| idx_operation_log_target | target | 单列 | 按操作目标筛选 |

#### BackupRecord 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_backup_record_clinic | clinicId | 单列 | 多租户备份记录查询 |
| idx_backup_clinic_created | clinicId, createdAt DESC | 复合 | 按诊所+时间查询备份 |

#### SystemAlert 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_system_alert_clinic_created | clinicId, createdAt DESC | 复合 | 按诊所查询系统告警 |
| idx_system_alert_level | level, createdAt DESC | 复合 | 按告警级别查询 |
| idx_system_alert_resolved | resolved, createdAt DESC | 复合 | 按解决状态筛选 |

---

### 2.2 患者相关索引

#### Patient 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_patient_clinic | clinicId | 单列 | 多租户查询 |
| idx_patient_name | name | 单列 | 姓名搜索 |
| idx_patient_phone | phone | 单列 | 电话搜索 |
| idx_patient_code | code | 单列 | 患者编号查询 |
| idx_patient_source | source | 单列 | 按来源渠道筛选 |
| idx_patient_created | createdAt | 单列 | 按创建时间排序 |
| idx_patient_clinic_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |
| idx_patient_clinic_name | clinicId, name | 复合 | 多租户姓名搜索 |
| idx_patient_clinic_phone | clinicId, phone | 复合 | 多租户电话搜索（前缀匹配优化） |
| idx_patient_clinic_code | clinicId, code | 复合 | 多租户编号查询（前缀匹配优化） |

#### Family 表

无额外索引（数据量小，主键查询为主）

#### FollowUp 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_followup_patient | patientId | 单列 | 按患者查询随访 |
| idx_followup_status | status | 单列 | 按状态筛选 |
| idx_followup_plan_date | planDate | 单列 | 按计划日期查询 |
| idx_followup_status_date | status, planDate | 复合 | 状态+日期组合查询 |
| idx_followup_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |
| idx_followup_clinic_patient | clinicId, patientId | 复合 | 多租户患者随访查询 |

#### FollowUpTemplate / FollowUpItem / FollowUpResult 表

| 索引名 | 表名 | 字段 | 类型 | 用途 |
|--------|------|------|------|------|
| idx_followuptemplate_clinic | FollowUpTemplate | clinicId | 单列 | 多租户模板查询 |
| idx_followupitem_clinic | FollowUpItem | clinicId | 单列 | 多租户项目查询 |
| idx_followupresult_clinic | FollowUpResult | clinicId | 单列 | 多租户结果查询 |
| idx_followup_item_template | FollowUpItem | templateId | 单列 | 按模板查询项目 |

#### AutoFollowUpRule 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_auto_followup_rule_clinic | clinicId | 单列 | 多租户自动随访规则查询 |

---

### 2.3 临床相关索引

#### Appointment 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_appointment_doctor | doctorId | 单列 | 按医生查询预约 |
| idx_appointment_patient | patientId | 单列 | 按患者查询预约 |
| idx_appointment_start_time | startTime | 单列 | 按开始时间查询 |
| idx_appointment_status | status | 单列 | 按状态筛选 |
| idx_appointment_doctor_start | doctorId, startTime | 复合 | 医生+时间范围查询 |
| idx_appointment_start_status | startTime, status | 复合 | 时间+状态组合查询 |
| idx_appointment_clinic_start | clinicId, startTime | 复合 | 多租户时间范围查询 |
| idx_appointment_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |
| idx_appointment_clinic_doctor | clinicId, doctorId | 复合 | 多租户医生预约查询 |
| idx_appointment_clinic_patient | clinicId, patientId | 复合 | 多租户患者预约查询 |
| idx_appointment_starttime_clinic | startTime, clinicId | 部分索引 | Dashboard 今日预约统计（deletedAt IS NULL） |

#### Visit 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_visit_patient | patientId | 单列 | 按患者查询就诊 |
| idx_visit_doctor | doctorId | 单列 | 按医生查询就诊 |
| idx_visit_status | status | 单列 | 按状态筛选 |
| idx_visit_doctor_start | doctorId, startTime | 复合 | 医生+开始时间查询 |
| idx_visit_clinic_patient | clinicId, patientId | 复合 | 多租户患者就诊查询 |
| idx_visit_starttime_clinic | startTime, clinicId | 部分索引 | Dashboard 今日就诊统计（deletedAt IS NULL） |

#### Registration 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_registration_patient | patientId | 单列 | 按患者查询挂号 |
| idx_registration_status | status | 单列 | 按状态筛选 |
| idx_registration_doctor_status | doctorId, status | 复合 | 医生+状态组合查询 |
| idx_registration_status_registered | status, registeredAt | 复合 | 状态+挂号时间查询 |
| idx_registration_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |

#### MedicalRecord 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_medical_record_patient | patientId | 单列 | 按患者查询病历 |
| idx_medical_record_visit | visitId | 单列 | 按就诊查询病历 |
| idx_medical_record_doctor_created | doctorId, createdAt | 复合 | 医生+创建时间查询 |
| idx_medical_record_clinic_patient | clinicId, patientId | 复合 | 多租户患者病历查询 |
| idx_medicalrecord_clinic_deleted_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |

#### RecordModifyRequest 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_record_modify_status | status, clinicId | 复合 | 按状态+诊所查询修改申请 |
| idx_record_modify_record | recordId, clinicId | 复合 | 按病历+诊所查询修改申请 |

#### MedicalRecordPhrase 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_medical_record_phrase_clinic | clinicId | 单列 | 多租户短语查询 |
| idx_medical_record_phrase_category | category | 单列 | 按分类筛选短语 |

#### Treatment 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_treatment_patient | patientId | 单列 | 按患者查询治疗 |
| idx_treatment_visit | visitId | 单列 | 按就诊查询治疗 |
| idx_treatment_status | status | 单列 | 按状态筛选 |
| idx_treatment_doctor_completed | doctorId, completedDate | 复合 | 医生+完成日期查询 |
| idx_treatment_clinic_patient | clinicId, patientId | 复合 | 多租户患者治疗查询 |
| idx_treatment_doctorid_clinic | doctorId, clinicId | 部分索引 | 医生工作量统计（deletedAt IS NULL） |

#### TreatmentPlan 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_treatment_plan_patient | patientId | 单列 | 按患者查询治疗计划 |
| idx_treatment_plan_status | status | 单列 | 按状态筛选 |
| idx_treatment_plan_clinic_patient | clinicId, patientId | 复合 | 多租户患者治疗计划查询 |

#### TreatmentPlanItem 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_treatment_plan_item_plan | planId | 单列 | 按计划查询明细（级联删除） |

#### ToothRecord 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_tooth_record_patient | patientId | 单列 | 按患者查询牙位记录 |
| idx_tooth_record_clinic_patient | clinicId, patientId | 复合 | 多租户患者牙位记录查询 |

#### FirstExam 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_first_exam_patient | patientId | 单列 | 按患者查询初诊 |
| idx_first_exam_status | status | 单列 | 按状态筛选 |
| idx_first_exam_doctor_date | doctorId, examDate | 复合 | 医生+检查日期查询 |
| idx_first_exam_clinic_patient | clinicId, patientId | 复合 | 多租户患者初诊查询 |

#### FirstExamTooth 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_first_exam_tooth_exam | examId | 单列 | 按初诊查询牙位（级联删除） |
| idx_first_exam_tooth_exam_tooth | examId, toothNumber | 复合 | Upsert 查询优化 |

#### FirstExamTrack 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_first_exam_track_exam | examId | 单列 | 按初诊查询跟踪 |

#### FirstExamFollowUp 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_first_exam_followup_exam | examId | 单列 | 按初诊查询随访 |

#### OralExamination 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_oral_exam_patient | patientId | 单列 | 按患者查询口腔检查 |
| idx_oral_exam_clinic_patient | clinicId, patientId | 复合 | 多租户患者口腔检查查询 |

#### PeriodontalRecord 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_periodontal_patient | patientId | 单列 | 按患者查询牙周记录 |
| idx_periodontal_clinic_patient | clinicId, patientId | 复合 | 多租户患者牙周记录查询 |

---

### 2.4 财务相关索引

#### Charge 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_charge_patient | patientId | 单列 | 按患者查询收费单 |
| idx_charge_status | status | 单列 | 按状态筛选 |
| idx_charge_visit | visitId | 单列 | 按就诊查询收费单 |
| idx_charge_paid_at_status | paidAt, status | 复合 | 支付时间+状态组合查询 |
| idx_charge_doctor_paid | doctorId, paidAt | 复合 | 医生+支付时间查询 |
| idx_charge_clinic_number | clinicId, number | 复合 | 多租户收费单号查询 |
| idx_charge_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |
| idx_charge_clinic_paidat | clinicId, paidAt | 复合 | 多租户支付时间范围查询 |
| idx_charge_clinic_patient | clinicId, patientId | 复合 | 多租户患者收费查询 |
| idx_charge_clinic_deleted_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |
| idx_charge_paidat_clinic | paidAt, clinicId | 部分索引 | 今日/本月收费统计（deletedAt IS NULL） |
| idx_charge_status_clinic | status, clinicId | 部分索引 | 未付单查询（deletedAt IS NULL） |

#### ChargeItem 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_charge_item_order | chargeId | 单列 | 按收费单查询明细（级联删除） |
| idx_charge_item_inventory | inventoryItemId | 单列 | 按库存物品查询 |
| idx_charge_item_treatment | treatmentId | 单列 | 按治疗项目查询 |

#### DebtRecord 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_debt_patient | patientId | 单列 | 按患者查询欠费 |
| idx_debt_status | status | 单列 | 按状态筛选 |
| idx_debt_charge | chargeId | 单列 | 按收费单查询欠费 |
| idx_debt_created | createdAt | 单列 | 按创建时间排序 |
| idx_debt_charge_unique | chargeId | 唯一索引 | 防止同一收费单重复欠费 |
| idx_debt_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |
| idx_debt_clinic_patient | clinicId, patientId | 复合 | 多租户患者欠费查询 |
| idx_debtrecord_clinic_deleted_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |

#### Refund 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_refund_charge | chargeId | 单列 | 按收费单查询退款 |
| idx_refund_patient | patientId | 单列 | 按患者查询退款 |
| idx_refund_created | createdAt | 单列 | 按创建时间排序 |
| idx_refund_clinic_charge | clinicId, chargeId | 复合 | 多租户收费单退款查询 |
| idx_refund_clinic_deleted_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |

#### MemberCard 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_member_card_patient | patientId | 单列 | 按患者查询会员卡 |
| idx_member_card_status | status | 单列 | 按状态筛选 |
| idx_member_card_status_balance | status, balance | 复合 | 状态+余额组合查询 |
| idx_member_card_clinic_patient | clinicId, patientId | 复合 | 多租户患者会员卡查询 |
| idx_membercard_clinic_deleted_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |
| idx_membercard_status_clinic | status, clinicId | 部分索引 | 活跃会员统计（deletedAt IS NULL） |

#### MemberCardLog 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_member_card_log_card | cardId | 单列 | 按会员卡查询流水（级联删除） |
| idx_membercardlog_charge | chargeId | 单列 | 按收费单查询流水 |
| idx_membercardlog_card_created | cardId, createdAt DESC | 复合 | 会员卡流水按时间倒序 |

#### MemberPointLog 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_memberpointlog_card_created | cardId, createdAt DESC | 复合 | 积分流水按时间倒序 |

---

### 2.5 库存相关索引

#### InventoryItem 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_inventory_item_code | code | 单列 | 物品编码查询 |
| idx_inventory_item_category | category | 单列 | 按分类筛选 |
| idx_inventory_item_supplier | supplierId | 单列 | 按供应商筛选 |
| idx_inventory_item_clinic_category | clinicId, category | 复合 | 多租户分类筛选 |
| idx_inventoryitem_clinic_deleted_created | clinicId, deletedAt, createdAt | 复合 | 多租户分页列表查询 |

#### Supplier 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_supplier_name | name | 单列 | 供应商名称搜索 |

#### InventoryTransaction 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_inv_trans_item_created | itemId, createdAt DESC | 复合 | 物品出入库流水 |
| idx_inv_trans_type_created | type, createdAt DESC | 复合 | 按类型查询流水 |
| idx_inv_trans_clinic_created | clinicId, createdAt DESC | 复合 | 多租户流水查询 |

#### PurchaseOrder 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_purchase_order_supplier | supplierId | 单列 | 按供应商查询采购单 |
| idx_purchase_order_status | status | 单列 | 按状态筛选 |
| idx_purchase_order_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |

#### PurchaseOrderItem 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_purchase_order_item_order | orderId | 单列 | 按采购单查询明细（级联删除） |

---

### 2.6 加工相关索引

#### ProcessingFactory 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_processing_factory_clinic | clinicId | 单列 | 多租户加工厂查询 |

#### ProcessingProduct 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_processing_product_factory | factoryId | 单列 | 按加工厂查询产品 |
| idx_processing_product_clinic | clinicId | 单列 | 多租户产品查询 |

#### ProcessingOrder 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_processing_order_patient | patientId | 单列 | 按患者查询加工单 |
| idx_processing_order_factory | factoryId | 单列 | 按加工厂查询 |
| idx_processing_order_status | status | 单列 | 按状态筛选 |
| idx_processing_order_clinic_status | clinicId, status | 复合 | 多租户状态筛选 |

#### ProcessingOrderItem 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_processing_order_item_order | orderId | 单列 | 按加工单查询明细（级联删除） |

#### ProcessingFlowLog 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_processing_flow_log_order | orderId | 单列 | 按加工单查询流程日志 |
| idx_processing_flow_log_clinic_order | clinicId, orderId | 复合 | 多租户加工单流程日志 |

---

### 2.7 设备/椅位相关索引

#### Equipment 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_equipment_name | name | 单列 | 设备名称搜索 |
| idx_equipment_category | category | 单列 | 按分类筛选 |
| idx_equipment_status | status | 单列 | 按状态筛选 |

#### Chair 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_chair_active | active | 单列 | 活跃椅位筛选 |

---

### 2.8 药房/影像相关索引

#### Prescription 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_prescription_patient | patientId | 单列 | 按患者查询处方 |
| idx_prescription_visit | visitId | 单列 | 按就诊查询处方 |
| idx_prescription_clinic_patient | clinicId, patientId | 复合 | 多租户患者处方查询 |

#### PrescriptionItem 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_prescription_item_prescription | prescriptionId | 单列 | 按处方查询明细（级联删除） |

#### Imaging 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_imaging_patient | patientId | 单列 | 按患者查询影像 |
| idx_imaging_visit | visitId | 单列 | 按就诊查询影像 |
| idx_imaging_clinic_patient | clinicId, patientId | 复合 | 多租户患者影像查询 |

---

### 2.9 微信相关索引

#### WechatMessage 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_wechat_message_patient | patientId | 单列 | 按患者查询微信消息 |
| idx_wechat_message_clinic_patient | clinicId, patientId | 复合 | 多租户患者微信消息查询 |

---

### 2.10 其他索引

#### ClinicInfo 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_clinicinfo_clinic | clinicId | 单列 | 按诊所查询配置 |

#### UsedRefreshToken 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_used_refresh_token_user | userId | 单列 | 按用户查询已使用 Token |
| idx_used_refresh_token_usedat | usedAt | 单列 | 定时清理过期 Token |

#### IdempotencyRecord 表

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| idx_idempotency_key | key | 单列 | 幂等键查询 |
| idx_idempotency_expires | expiresAt | 单列 | 定时清理过期记录 |

---

## 3. 索引使用建议

### 3.1 查询优化建议

#### 多租户查询
- **必须**包含 `clinicId` 条件，以利用 `clinicId` 前缀的复合索引
- 避免只使用非 `clinicId` 开头的索引字段进行查询

```sql
-- 好：使用复合索引
SELECT * FROM Patient WHERE clinicId = ? AND name LIKE ?;

-- 不好：无法有效利用复合索引
SELECT * FROM Patient WHERE name LIKE ?;
```

#### 模糊查询
- 前缀匹配（`LIKE 'abc%'`）可以利用索引
- 后缀匹配（`LIKE '%abc'`）和中间匹配（`LIKE '%abc%'`）无法利用索引
- 对于患者搜索，使用 `clinicId + phone` 或 `clinicId + code` 的复合索引进行前缀匹配

#### 范围查询
- 范围查询（`>`, `<`, `BETWEEN`）的列应放在复合索引的末尾
- 等值查询列在前，范围查询列在后

```sql
-- 好：等值列在前，范围列在后
-- 索引：idx_appointment_doctor_start (doctorId, startTime)
SELECT * FROM Appointment WHERE doctorId = ? AND startTime BETWEEN ? AND ?;
```

#### ORDER BY 优化
- 如果 ORDER BY 的列在索引中，可以避免排序操作
- 排序方向应与索引定义一致（如 `createdAt DESC`）

### 3.2 索引使用场景

#### 应该建索引的场景
- WHERE 子句中经常使用的列
- JOIN 操作中关联的列
- ORDER BY / GROUP BY 的列
- DISTINCT 的列
- 多表连接的外键列

#### 不应该建索引的场景
- 数据量很小的表（如配置表、字典表）
- 频繁更新的列（写入开销大）
- 选择性低的列（如性别、状态等只有少数几个值的列，除非是复合索引的一部分）
- 很少在查询中使用的列

---

## 4. 性能优化建议

### 4.1 复合索引设计

**最左前缀原则**：复合索引按照定义的顺序，从左到右匹配查询条件。

例如索引 `idx_charge_clinic_status (clinicId, status)`：
- ✅ `WHERE clinicId = ?` - 可以使用索引
- ✅ `WHERE clinicId = ? AND status = ?` - 可以使用索引
- ❌ `WHERE status = ?` - 无法使用索引（缺少最左列）

### 4.2 部分索引优化

部分索引只索引表中满足特定条件的行，可以显著减小索引体积。

**应用场景**：
- 统计查询只关心未删除的数据（`deletedAt IS NULL`）
- 只查询特定状态的数据

**示例**：
```sql
-- 部分索引：只索引未删除的收费单，按支付时间+诊所查询
CREATE INDEX idx_charge_paidat_clinic ON Charge(paidAt, clinicId) WHERE deletedAt IS NULL;
```

### 4.3 覆盖索引

如果索引包含查询所需的所有列，则可以直接从索引返回数据，无需回表查询。

**示例**：
```sql
-- 查询：SELECT id, name FROM Patient WHERE clinicId = ? ORDER BY createdAt
-- 现有索引：idx_patient_clinic_created (clinicId, deletedAt, createdAt)
-- 优化：如果需要经常查询 name，可以考虑加进去
```

### 4.4 索引维护

#### 定期检查
- 监控慢查询，识别需要添加索引的场景
- 检查未使用的索引，考虑删除以减少写入开销

#### 索引重建
- SQLite 的索引会随着数据增删而产生碎片
- 可以使用 `REINDEX` 命令重建索引以优化性能

### 4.5 常见优化场景

#### 1. 分页列表查询
**场景**：后台管理系统的列表页，带有多条件筛选和分页。

**优化**：
- 使用 `clinicId + deletedAt + createdAt` 复合索引
- 查询时带上 `clinicId` 和 `deletedAt IS NULL` 条件
- 用 `createdAt` 排序和分页

#### 2. Dashboard 统计
**场景**：首页 Dashboard 的今日/本月数据统计。

**优化**：
- 使用部分索引（`WHERE deletedAt IS NULL`）
- 索引以时间字段开头，便于范围查询
- 配合 `clinicId` 做多租户隔离

#### 3. 患者搜索
**场景**：按姓名、电话、编号搜索患者。

**优化**：
- 使用 `clinicId + name/phone/code` 复合索引
- 尽量使用前缀匹配（`LIKE '张%'`）
- 避免全模糊匹配（`LIKE '%张%'`），必要时考虑全文搜索

#### 4. 医生工作量统计
**场景**：按医生统计工作量、治疗数量等。

**优化**：
- 使用 `doctorId + clinicId` 部分索引
- 索引只包含未删除的数据
- 避免全表扫描

---

## 5. 索引创建工具函数

项目中使用 `createIndexIfNotExists` 函数创建索引，定义在 `src/db/schema/indexes.ts`：

```typescript
const createIndexIfNotExists = (db: Database, name: string, table: string, columns: string, where?: string) => {
  const whereClause = where ? ` WHERE ${where}` : '';
  db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})${whereClause}`);
};
```

**支持的功能**：
- 自动检测索引是否存在，不存在则创建
- 支持普通索引和复合索引
- 支持部分索引（通过 `where` 参数）
- 创建失败时记录警告，不抛出异常
