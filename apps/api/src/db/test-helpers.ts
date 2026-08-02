import Database from 'better-sqlite3';
import { Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IDatabase } from './db.interface';
import { DbService } from './db.service';
import { systemTables } from './schema/system.tables';
import { patientTables } from './schema/patient.tables';
import { clinicalTables } from './schema/clinical.tables';
import { financialTables } from './schema/financial.tables';
import { pharmacyTables } from './schema/pharmacy.tables';
import { inventoryTables } from './schema/inventory.tables';
import { wechatTables } from './schema/wechat.tables';
import { analyticsTables } from './schema/analytics.tables';
import { hrTables } from './schema/hr.tables';
import { CURRENT_VERSION } from './migrations';
import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE,
  SQLITE_JOURNAL_MODE,
  SQLITE_SYNCHRONOUS,
  SQLITE_TEMP_STORE,
  SQLITE_MMAP_SIZE,
  SQLITE_WAL_AUTOCHECKPOINT,
} from '../config/constants';
import { ClinicContextService } from '../common/services/clinic-context.service';
import {
  createClinicFactory,
  createUserFactory,
  createPatientFactory,
  createMemberCardFactory,
} from '../../test/factories';

type DbInstance = InstanceType<typeof Database>;

const ALL_TABLE_SCHEMAS = [
  ...systemTables,
  ...patientTables,
  ...clinicalTables,
  ...financialTables,
  ...pharmacyTables,
  ...inventoryTables,
  ...wechatTables,
  ...analyticsTables,
  ...hrTables,
];

export function createTestDb(): DbInstance {
  const db = new Database(':memory:');
  db.pragma('encoding = "UTF-8"');
  db.pragma(`journal_mode = ${SQLITE_JOURNAL_MODE}`);
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.pragma(`synchronous = ${SQLITE_SYNCHRONOUS}`);
  db.pragma(`cache_size = ${SQLITE_CACHE_SIZE}`);
  db.pragma(`temp_store = ${SQLITE_TEMP_STORE}`);
  db.pragma(`mmap_size = ${SQLITE_MMAP_SIZE}`);
  db.pragma(`wal_autocheckpoint = ${SQLITE_WAL_AUTOCHECKPOINT}`);
  db.pragma('foreign_keys = ON');

  for (const sql of ALL_TABLE_SCHEMAS) {
    db.exec(sql);
  }

  createTestIndexes(db);

  applyMigrationsToDb(db);

  return db;
}

function createTestIndexes(db: DbInstance): void {
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_clinic_code ON Clinic(code)',
    'CREATE INDEX IF NOT EXISTS idx_clinic_active ON Clinic(isActive)',
    'CREATE INDEX IF NOT EXISTS idx_user_clinic ON User(clinicId)',
    'CREATE INDEX IF NOT EXISTS idx_patient_clinic ON Patient(clinicId)',
    'CREATE INDEX IF NOT EXISTS idx_used_refresh_token_user ON UsedRefreshToken(userId)',
    'CREATE INDEX IF NOT EXISTS idx_patient_name ON Patient(name)',
    'CREATE INDEX IF NOT EXISTS idx_patient_phone ON Patient(phone)',
    'CREATE INDEX IF NOT EXISTS idx_patient_code ON Patient(code)',
    'CREATE INDEX IF NOT EXISTS idx_patient_source ON Patient(source)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_doctor ON Appointment(doctorId)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_patient ON Appointment(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_start_time ON Appointment(startTime)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_status ON Appointment(status)',
    'CREATE INDEX IF NOT EXISTS idx_visit_patient ON Visit(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_visit_doctor ON Visit(doctorId)',
    'CREATE INDEX IF NOT EXISTS idx_visit_status ON Visit(status)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_patient ON Treatment(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_visit ON Treatment(visitId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_status ON Treatment(status)',
    'CREATE INDEX IF NOT EXISTS idx_charge_patient ON Charge(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_charge_status ON Charge(status)',
    'CREATE INDEX IF NOT EXISTS idx_charge_visit ON Charge(visitId)',
    'CREATE INDEX IF NOT EXISTS idx_prescription_patient ON Prescription(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_prescription_visit ON Prescription(visitId)',
    'CREATE INDEX IF NOT EXISTS idx_imaging_patient ON Imaging(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_imaging_visit ON Imaging(visitId)',
    'CREATE INDEX IF NOT EXISTS idx_followup_patient ON FollowUp(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_followup_status ON FollowUp(status)',
    'CREATE INDEX IF NOT EXISTS idx_followup_plan_date ON FollowUp(planDate)',
    'CREATE INDEX IF NOT EXISTS idx_member_card_patient ON MemberCard(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_member_card_status ON MemberCard(status)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_item_code ON InventoryItem(code)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_item_category ON InventoryItem(category)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_item_supplier ON InventoryItem(supplierId)',
    'CREATE INDEX IF NOT EXISTS idx_supplier_name ON Supplier(name)',
    'CREATE INDEX IF NOT EXISTS idx_equipment_name ON Equipment(name)',
    'CREATE INDEX IF NOT EXISTS idx_equipment_category ON Equipment(category)',
    'CREATE INDEX IF NOT EXISTS idx_equipment_status ON Equipment(status)',
    'CREATE INDEX IF NOT EXISTS idx_registration_patient ON Registration(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_registration_status ON Registration(status)',
    'CREATE INDEX IF NOT EXISTS idx_medical_record_patient ON MedicalRecord(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_medical_record_visit ON MedicalRecord(visitId)',
    'CREATE INDEX IF NOT EXISTS idx_tooth_record_patient ON ToothRecord(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_order_supplier ON PurchaseOrder(supplierId)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_order_status ON PurchaseOrder(status)',
    'CREATE INDEX IF NOT EXISTS idx_processing_order_patient ON ProcessingOrder(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_processing_order_factory ON ProcessingOrder(factoryId)',
    'CREATE INDEX IF NOT EXISTS idx_processing_order_status ON ProcessingOrder(status)',
    'CREATE INDEX IF NOT EXISTS idx_user_username ON User(username)',
    'CREATE INDEX IF NOT EXISTS idx_user_role ON User(role)',
    'CREATE INDEX IF NOT EXISTS idx_operation_log_user ON OperationLog(userId)',
    'CREATE INDEX IF NOT EXISTS idx_operation_log_created ON OperationLog(createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_chair_active ON Chair(active)',
    'CREATE INDEX IF NOT EXISTS idx_first_exam_patient ON FirstExam(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_first_exam_status ON FirstExam(status)',
    'CREATE INDEX IF NOT EXISTS idx_oral_exam_patient ON OralExamination(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_periodontal_patient ON PeriodontalRecord(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_plan_patient ON TreatmentPlan(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_plan_status ON TreatmentPlan(status)',
    'CREATE INDEX IF NOT EXISTS idx_charge_item_order ON ChargeItem(chargeId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_plan_item_plan ON TreatmentPlanItem(planId)',
    'CREATE INDEX IF NOT EXISTS idx_prescription_item_prescription ON PrescriptionItem(prescriptionId)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_order_item_order ON PurchaseOrderItem(orderId)',
    'CREATE INDEX IF NOT EXISTS idx_processing_order_item_order ON ProcessingOrderItem(orderId)',
    'CREATE INDEX IF NOT EXISTS idx_processing_flow_log_order ON ProcessingFlowLog(orderId)',
    'CREATE INDEX IF NOT EXISTS idx_member_card_log_card ON MemberCardLog(cardId)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_transaction_item ON InventoryTransaction(itemId)',
    'CREATE INDEX IF NOT EXISTS idx_wechat_message_patient ON WechatMessage(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_refund_charge ON Refund(chargeId)',
    'CREATE INDEX IF NOT EXISTS idx_debt_patient ON DebtRecord(patientId)',
    'CREATE INDEX IF NOT EXISTS idx_debt_status ON DebtRecord(status)',
    'CREATE INDEX IF NOT EXISTS idx_debt_charge ON DebtRecord(chargeId)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)',
    'CREATE INDEX IF NOT EXISTS idx_debt_created ON DebtRecord(createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_idempotency_key ON IdempotencyRecord(`key`)',
    'CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON IdempotencyRecord(expiresAt)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_doctor_start ON Appointment(doctorId, startTime)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_start_status ON Appointment(startTime, status)',
    'CREATE INDEX IF NOT EXISTS idx_charge_paid_at_status ON Charge(paidAt, status)',
    'CREATE INDEX IF NOT EXISTS idx_charge_doctor_paid ON Charge(doctorId, paidAt)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_doctor_completed ON Treatment(doctorId, completedDate)',
    'CREATE INDEX IF NOT EXISTS idx_patient_created ON Patient(createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_visit_doctor_start ON Visit(doctorId, startTime)',
    'CREATE INDEX IF NOT EXISTS idx_member_card_status_balance ON MemberCard(status, balance)',
    'CREATE INDEX IF NOT EXISTS idx_registration_doctor_status ON Registration(doctorId, status)',
    'CREATE INDEX IF NOT EXISTS idx_registration_status_registered ON Registration(status, registeredAt)',
    'CREATE INDEX IF NOT EXISTS idx_medical_record_doctor_created ON MedicalRecord(doctorId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_first_exam_doctor_date ON FirstExam(doctorId, examDate)',
    'CREATE INDEX IF NOT EXISTS idx_followup_status_date ON FollowUp(status, planDate)',
    'CREATE INDEX IF NOT EXISTS idx_charge_clinic_status ON Charge(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_charge_clinic_paidat ON Charge(clinicId, paidAt)',
    'CREATE INDEX IF NOT EXISTS idx_charge_clinic_patient ON Charge(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_clinic_start ON Appointment(clinicId, startTime)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_clinic_status ON Appointment(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_appointment_clinic_doctor ON Appointment(clinicId, doctorId)',
    'CREATE INDEX IF NOT EXISTS idx_patient_clinic_created ON Patient(clinicId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_patient_clinic_name ON Patient(clinicId, name)',
    'CREATE INDEX IF NOT EXISTS idx_debt_clinic_status ON DebtRecord(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_debt_clinic_patient ON DebtRecord(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_operation_log_clinic_created ON OperationLog(clinicId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_registration_clinic_status ON Registration(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_medical_record_clinic_patient ON MedicalRecord(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_order_clinic_status ON PurchaseOrder(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_processing_order_clinic_status ON ProcessingOrder(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_refund_clinic_charge ON Refund(clinicId, chargeId)',
    'CREATE INDEX IF NOT EXISTS idx_member_card_clinic_patient ON MemberCard(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_item_clinic_category ON InventoryItem(clinicId, category)',
    'CREATE INDEX IF NOT EXISTS idx_prescription_clinic_patient ON Prescription(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_visit_clinic_patient ON Visit(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_clinic_patient ON Treatment(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_treatment_plan_clinic_patient ON TreatmentPlan(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_imaging_clinic_patient ON Imaging(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_followup_clinic_status ON FollowUp(clinicId, status)',
    'CREATE INDEX IF NOT EXISTS idx_followup_clinic_patient ON FollowUp(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_tooth_record_clinic_patient ON ToothRecord(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_first_exam_clinic_patient ON FirstExam(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_oral_exam_clinic_patient ON OralExamination(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_periodontal_clinic_patient ON PeriodontalRecord(clinicId, patientId)',
    'CREATE INDEX IF NOT EXISTS idx_wechat_message_clinic_patient ON WechatMessage(clinicId, patientId)',
  ];

  for (const sql of indexStatements) {
    try {
      db.exec(sql);
    } catch {
      // 索引已存在或表不存在时跳过
    }
  }
}

function columnExists(db: DbInstance, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
}

function addColumnIfMissing(db: DbInstance, table: string, column: string, definition: string): void {
  try {
    if (!columnExists(db, table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  } catch {
    // 表不存在时跳过
  }
}

function tableExists(db: DbInstance, table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(table) as { name: string } | undefined;
  return Boolean(row);
}

function ensureMigrationTable(db: DbInstance): void {
  if (!tableExists(db, 'schema_migrations')) {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        appliedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        durationMs INTEGER DEFAULT 0
      );
    `);
    return;
  }
  addColumnIfMissing(db, 'schema_migrations', 'name', 'TEXT');
  addColumnIfMissing(db, 'schema_migrations', 'appliedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing(db, 'schema_migrations', 'durationMs', 'INTEGER DEFAULT 0');
}

function applyMigrationsToDb(db: DbInstance): void {
  ensureMigrationTable(db);

  db.pragma(`user_version = ${CURRENT_VERSION}`);

  const tablesNeedUpdatedAt = [
    'ChargeItem', 'TreatmentPlanItem', 'PrescriptionItem', 'PurchaseOrderItem',
    'MemberCardLog', 'MemberPointLog', 'InventoryTransaction', 'OperationLog',
    'BackupRecord', 'SmsLog', 'WechatMessage', 'Refund', 'Invoice',
    'SatisfactionSurvey', 'NpsSnapshot',
  ];
  tablesNeedUpdatedAt.forEach(table => {
    addColumnIfMissing(db, table, 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  });

  const tablesNeedDeletedAt = [
    'MedicalRecord', 'Patient', 'Appointment', 'Prescription', 'PrescriptionItem',
    'Visit', 'Treatment', 'TreatmentPlan', 'TreatmentPlanItem', 'Imaging',
    'OralExamination', 'PeriodontalRecord', 'Charge', 'ChargeItem', 'Refund',
    'MemberCard', 'Registration', 'FollowUp', 'FirstExam', 'ToothRecord',
    'InventoryItem', 'Supplier', 'ProcessingFactory', 'ProcessingOrder',
    'DebtRecord', 'WechatMessage', 'FirstExamTrack', 'PurchaseOrder',
  ];
  tablesNeedDeletedAt.forEach(table => {
    addColumnIfMissing(db, table, 'deletedAt', 'TEXT');
  });

  addColumnIfMissing(db, 'Charge', 'refundedAmount', 'INTEGER DEFAULT 0');

  addColumnIfMissing(db, 'Appointment', 'visitId', 'TEXT');

  addColumnIfMissing(db, 'ChargeItem', 'inventoryItemId', 'TEXT');
  addColumnIfMissing(db, 'ChargeItem', 'consumedQuantity', 'REAL DEFAULT 0');

  // ============= SatisfactionSurvey 所有列（迁移时兼容） =============
  addColumnIfMissing(db, 'SatisfactionSurvey', 'id', 'TEXT PRIMARY KEY');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'visitId', 'TEXT UNIQUE');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'appointmentId', 'TEXT');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'patientId', 'TEXT NOT NULL');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'doctorId', 'TEXT');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'npsScore', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'ratingMedical', 'INTEGER');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'ratingService', 'INTEGER');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'ratingEnvironment', 'INTEGER');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'ratingPrice', 'INTEGER');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'ratingWait', 'INTEGER');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'comment', 'TEXT');
  addColumnIfMissing(db, 'SatisfactionSurvey', 'tags', "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, 'SatisfactionSurvey', 'source', "TEXT DEFAULT 'CLINIC'");
  addColumnIfMissing(db, 'SatisfactionSurvey', 'createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');

  // ============= NpsSnapshot 所有列（迁移时兼容） =============
  addColumnIfMissing(db, 'NpsSnapshot', 'id', 'TEXT PRIMARY KEY');
  addColumnIfMissing(db, 'NpsSnapshot', 'snapshotDate', 'TEXT NOT NULL');
  addColumnIfMissing(db, 'NpsSnapshot', 'totalResponses', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'NpsSnapshot', 'promoters', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'NpsSnapshot', 'detractors', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'NpsSnapshot', 'passives', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'NpsSnapshot', 'nps', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'NpsSnapshot', 'avgRatingMedical', 'REAL');
  addColumnIfMissing(db, 'NpsSnapshot', 'avgRatingService', 'REAL');
  addColumnIfMissing(db, 'NpsSnapshot', 'avgRatingEnvironment', 'REAL');
  addColumnIfMissing(db, 'NpsSnapshot', 'avgRatingPrice', 'REAL');
  addColumnIfMissing(db, 'NpsSnapshot', 'avgRatingWait', 'REAL');
  addColumnIfMissing(db, 'NpsSnapshot', 'negativeKeywordCount', "TEXT DEFAULT '{}'");

  const tablesNeedClinicId = [
    'User', 'Patient', 'Appointment', 'Visit', 'Treatment', 'TreatmentPlan',
    'Charge', 'ChargeItem', 'Prescription', 'Imaging', 'ToothRecord',
    'MemberCard', 'InventoryItem', 'Supplier', 'PurchaseOrder', 'ProcessingOrder',
    'Refund', 'Registration', 'MedicalRecord', 'OralExamination',
    'PeriodontalRecord', 'FirstExam', 'Equipment', 'DebtRecord', 'WechatMessage',
    'FollowUp', 'Chair', 'TreatmentCatalog', 'DrugCatalog', 'ChargeCombo',
    'PaymentMethod', 'ProcessingFactory', 'BackupRecord',
  ];
  tablesNeedClinicId.forEach(table => {
    addColumnIfMissing(db, table, 'clinicId', 'TEXT');
  });
}

export function cleanupTestDb(db: DbInstance): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // 忽略 checkpoint 错误
  }
  try {
    db.close();
  } catch {
    // 忽略关闭错误
  }
}

class TestDbService extends DbService {
  private testDb: DbInstance;

  constructor(db: DbInstance) {
    super();
    this.testDb = db;
  }

  async onModuleInit(): Promise<void> {
    // 不执行真实的初始化，使用传入的内存数据库
  }

  async onModuleDestroy(): Promise<void> {
    // 不关闭数据库，由测试方管理生命周期
  }

  get db(): IDatabase {
    // 与生产 DbService 保持一致：返回自身（实现 IDatabase，含 transaction）
    return this;
  }

  prepare(sql: string): ReturnType<IDatabase['prepare']> {
    return this.testDb.prepare(sql);
  }

  exec(sql: string): void {
    this.testDb.exec(sql);
  }

  transaction<T>(fn: (db: IDatabase) => T): T {
    const txFn = this.testDb.transaction(fn);
    return txFn(this);
  }

  checkpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'TRUNCATE'): void {
    try {
      this.testDb.pragma(`wal_checkpoint(${mode})`);
    } catch {
      // 忽略 checkpoint 错误
    }
  }

  rebuildConnection(): void {
    // 内存数据库不重建
  }
}

export function createTestDbService(db: DbInstance): DbService {
  return new TestDbService(db);
}

export interface ClinicContextSeed {
  clinicId: string;
  userId: string;
  role: string;
  userAgent?: string;
  source?: string;
}

/**
 * 在独立的诊所上下文中执行函数。
 * 需要传入由 DI 容器创建的 ClinicContextService 实例（与注入到 Service 中的是同一实例），
 * 这样 run() 设置的上下文才能被 Service 内部的 getClinicId() 读取到。
 */
export function runInClinicContext<T>(
  clinicContext: ClinicContextService,
  context: ClinicContextSeed,
  fn: () => T,
): T {
  return clinicContext.run(
    { userAgent: null, source: null, ...context },
    fn,
  );
}

export interface SeedTestDataOptions {
  withMemberCard?: boolean;
}

/**
 * 向测试数据库写入基础种子数据（诊所、用户、患者，可选会员卡）。
 * 数据由工厂函数生成，测试可覆盖或直接使用。
 */
export function seedTestData(db: DbInstance, options: SeedTestDataOptions = {}): void {
  const clinic = createClinicFactory();
  const user = createUserFactory();
  const patient = createPatientFactory();

  db.prepare(
    "INSERT INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(clinic.id, clinic.name, clinic.code, clinic.isActive, clinic.createdAt, clinic.updatedAt);

  db.prepare(
    "INSERT INTO User (id, username, passwordHash, name, role, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(user.id, user.username, user.passwordHash, user.name, user.role, user.clinicId, user.active, user.createdAt, user.updatedAt);

  db.prepare(
    "INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(patient.id, patient.code, patient.name, patient.gender, patient.phone, patient.clinicId, patient.active, patient.createdAt, patient.updatedAt);

  if (options.withMemberCard) {
    const card = createMemberCardFactory();
    db.prepare(
      "INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(card.id, card.patientId, card.cardNo, card.balance, card.totalRecharge, card.totalConsume, card.status, card.clinicId, card.createdAt, card.updatedAt);
  }
}

export async function setupTestModule(
  providers: Provider[] = [],
): Promise<{ module: TestingModule; db: DbInstance; dbService: DbService }> {
  const db = createTestDb();
  const testDbService = new TestDbService(db);

  const module = await Test.createTestingModule({
    providers: [
      {
        provide: DbService,
        useValue: testDbService,
      },
      ...providers,
    ],
  }).compile();

  const dbService = module.get(DbService);

  return { module, db, dbService };
}
