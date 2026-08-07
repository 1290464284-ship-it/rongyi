import type { Migration } from './index';
import { addColumns } from './helpers';

// 迁移版本 141..146（M-04：由 migrations.ts 拆分）
export const migrations141to146: Migration[] = [
  {
    version: 141,
    name: 'v2-feature-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_imaging_category ON Imaging(categoryId);
        CREATE INDEX IF NOT EXISTS idx_v2_followup_execution ON FollowUp(executionStatus);
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_batch_item ON InventoryBatch(itemId, active);
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_batch_expiry ON InventoryBatch(itemId, expiryDate);
        CREATE INDEX IF NOT EXISTS idx_v2_stocktake_item_stocktake ON StocktakeItem(stocktakeId);
        CREATE INDEX IF NOT EXISTS idx_v2_dispense_status ON Dispense(status);
        CREATE INDEX IF NOT EXISTS idx_v2_refund_status ON Refund(status);
        CREATE INDEX IF NOT EXISTS idx_v2_medical_record_edit ON MedicalRecord(editRequestStatus);
        CREATE INDEX IF NOT EXISTS idx_v2_purchase_order_review ON PurchaseOrder(reviewStatus);
        CREATE INDEX IF NOT EXISTS idx_v2_processing_settle ON ProcessingOrder(settleStatus);
      `);
    },
  },  {
    version: 142,
    name: 'v2-medical-record-proposed-content',
    up(db) {
      addColumns(db, 'MedicalRecord', [
        ['proposedContentJson', 'TEXT'],
      ]);
    },
  },  {
    version: 143,
    name: 'v2-wechat-reminder-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_wechat_reminder_due ON WechatReminder(clinicId, scheduledDate, status);
        CREATE INDEX IF NOT EXISTS idx_v2_wechat_reminder_source ON WechatReminder(sourceId);
      `);
    },
  },  {
    version: 144,
    name: 'v2-r2-feature-fields',
    up(db) {
      addColumns(db, 'Registration', [['departmentId', 'TEXT']]);
      addColumns(db, 'FirstExam', [['dentition', 'TEXT'], ['previousExamId', 'TEXT'], ['restartedAt', 'TEXT']]);
      addColumns(db, 'FirstExamTooth', [['chiefMark', 'TEXT']]);
      addColumns(db, 'TreatmentPlan', [
        ['discountType', 'TEXT'],
        ['discountRate', 'REAL'],
        ['followUpStatus', 'TEXT'],
        ['nextFollowUpAt', 'TEXT'],
        ['trackingNote', 'TEXT'],
      ]);
      addColumns(db, 'TreatmentPlanItem', [['discountRate', 'REAL'], ['billed', 'INTEGER'], ['billedChargeId', 'TEXT']]);
      addColumns(db, 'Charge', [['payMethodName', 'TEXT']]);
      addColumns(db, 'Prescription', [['status', 'TEXT'], ['processedAt', 'TEXT'], ['chargeId', 'TEXT'], ['dispenseId', 'TEXT']]);
      addColumns(db, 'InventoryItem', [['isHighValue', 'INTEGER'], ['catalogId', 'TEXT']]);
      addColumns(db, 'CephalometricCase', [['reportJson', 'TEXT'], ['reportStatus', 'TEXT']]);
      addColumns(db, 'TreatmentCatalog', [['parentId', 'TEXT'], ['businessCategory', 'TEXT']]);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_inv_txn_report ON InventoryTransaction(clinicId, type, referenceType, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_tp_item_billed ON TreatmentPlanItem(clinicId, planId, billed);
        CREATE INDEX IF NOT EXISTS idx_v2_prescription_status ON Prescription(clinicId, status);
        CREATE INDEX IF NOT EXISTS idx_v2_registration_dept ON Registration(clinicId, departmentId, status);
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_doc_type ON InventoryDoc(clinicId, type, status);
        CREATE INDEX IF NOT EXISTS idx_v2_follow_up_dict ON FollowUpDict(clinicId, dictType, active);
      `);
    },
  },  {
    version: 145,
    name: 'v2-query-index-gaps',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_appointment_clinic_start ON Appointment(clinicId, startTime);
        CREATE INDEX IF NOT EXISTS idx_v2_medical_record_clinic_created ON MedicalRecord(clinicId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_clinic_created ON Charge(clinicId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_operation_log_created ON OperationLog(createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_notification_clinic_created ON Notification(clinicId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_business_alert_clinic_created ON BusinessAlert(clinicId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_attendance_clinic_created ON Attendance(clinicId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_file_record_clinic_creator ON FileRecord(clinicId, createdBy);
        CREATE INDEX IF NOT EXISTS idx_v2_debt_charge ON Debt(chargeId);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_item_charge ON ChargeItem(chargeId);
        CREATE INDEX IF NOT EXISTS idx_v2_refund_charge ON Refund(chargeId);
        CREATE INDEX IF NOT EXISTS idx_v2_dispense_clinic_created ON Dispense(clinicId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_member_card_log_card ON MemberCardLog(cardId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_member_point_log_card ON MemberPointLog(cardId, createdAt);
      `);
    },
  },  {
    version: 146,
    name: 'v2-payment-ledger-and-query-indexes',
    up(db) {
      // 收款/退款流水账：记录每一笔支付与退款（含会员卡逐笔冲销依据），
      // 修复混合支付/多笔部分支付退款时会员卡余额回充错误的根因。
      db.exec(`
        CREATE TABLE IF NOT EXISTS PaymentLedger (
          id TEXT PRIMARY KEY,
          clinicId TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT,
          chargeId TEXT NOT NULL,
          patientId TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('PAY', 'REFUND')),
          method TEXT NOT NULL,
          amount INTEGER NOT NULL,
          cardId TEXT,
          operatorId TEXT,
          reversedAmount INTEGER NOT NULL DEFAULT 0,
          relatedId TEXT,
          allocations TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_v2_payment_ledger_charge ON PaymentLedger(chargeId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_payment_ledger_related ON PaymentLedger(relatedId);
      `);
      // 回填历史已收款数据（单条有界：最多可冲销 paidAmount，绝不超扣）。
      db.exec(`
        INSERT INTO PaymentLedger (
          id, clinicId, createdAt, updatedAt, deletedAt,
          chargeId, patientId, type, method, amount, cardId, operatorId,
          reversedAmount, relatedId, allocations
        )
        SELECT 'ledger-backfill-' || id, clinicId, COALESCE(paidAt, createdAt), COALESCE(paidAt, createdAt), NULL,
               id, patientId, 'PAY', COALESCE(payMethod, 'CASH'), paidAmount, memberCardId, NULL,
               0, NULL, NULL
        FROM Charge
        WHERE deletedAt IS NULL AND paidAmount > 0
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_dispense_item_dispense ON DispenseItem(dispenseId);
        CREATE INDEX IF NOT EXISTS idx_v2_narcotic_registry_clinic_date ON NarcoticRegistry(clinicId, recordDate);
        CREATE INDEX IF NOT EXISTS idx_v2_attendance_work_date_clinic ON Attendance(workDate, clinicId);
        CREATE INDEX IF NOT EXISTS idx_v2_purchase_order_item_order ON PurchaseOrderItem(orderId);
        CREATE INDEX IF NOT EXISTS idx_v2_processing_order_item_order ON ProcessingOrderItem(orderId);
        CREATE INDEX IF NOT EXISTS idx_v2_prescription_item_prescription ON PrescriptionItem(prescriptionId);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_clinic_paid_at ON Charge(clinicId, paidAt);
      `);
    },
  },
];
