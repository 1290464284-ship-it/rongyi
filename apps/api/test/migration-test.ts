/**
 * 数据库迁移 v0→v3 真实数据平滑性测试
 * 
 * 测试流程：
 * 1. 构造 v0 初始 schema（仅基础表，无迁移列）
 * 2. 插入真实样本数据
 * 3. 依次执行 v1、v2、v3 迁移
 * 4. 验证：数据不丢失、新增列有默认值、索引生效、幂等性
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

// 使用 better-sqlite3 native binding（与生产一致）
const bindingsPath = process.env.BETTER_SQLITE3_BINDINGS_PATH;
const dbOptions: any = {};
if (bindingsPath) {
  dbOptions.nativeBinding = bindingsPath;
}

const tmpDir = path.join(os.tmpdir(), `dental-migration-test-${Date.now()}`);
const tmpDbPath = path.join(tmpDir, 'test.sqlite');

// v0 基础 schema（仅包含核心列，模拟最早版本）
const V0_SCHEMA = `
  CREATE TABLE User (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'RECEPTIONIST',
    active INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE Patient (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    gender TEXT NOT NULL,
    birthDate TEXT,
    phone TEXT NOT NULL,
    address TEXT,
    remark TEXT,
    active INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE Appointment (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    doctorId TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    status TEXT DEFAULT 'BOOKED',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id),
    FOREIGN KEY (doctorId) REFERENCES User(id)
  );

  CREATE TABLE Visit (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    appointmentId TEXT UNIQUE,
    doctorId TEXT NOT NULL,
    chiefComplaint TEXT,
    diagnosis TEXT,
    treatmentPlan TEXT,
    startTime TEXT DEFAULT CURRENT_TIMESTAMP,
    endTime TEXT,
    status TEXT DEFAULT 'IN_PROGRESS',
    FOREIGN KEY (patientId) REFERENCES Patient(id),
    FOREIGN KEY (appointmentId) REFERENCES Appointment(id),
    FOREIGN KEY (doctorId) REFERENCES User(id)
  );

  CREATE TABLE Charge (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    visitId TEXT,
    doctorId TEXT,
    number TEXT UNIQUE NOT NULL,
    totalAmount REAL NOT NULL,
    paidAmount REAL DEFAULT 0,
    status TEXT DEFAULT 'UNPAID',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE ChargeItem (
    id TEXT PRIMARY KEY,
    chargeId TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    subtotal REAL NOT NULL,
    FOREIGN KEY (chargeId) REFERENCES Charge(id)
  );

  CREATE TABLE Prescription (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    visitId TEXT,
    doctorId TEXT NOT NULL,
    remark TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id),
    FOREIGN KEY (doctorId) REFERENCES User(id)
  );

  CREATE TABLE PrescriptionItem (
    id TEXT PRIMARY KEY,
    prescriptionId TEXT NOT NULL,
    drugName TEXT NOT NULL,
    spec TEXT NOT NULL,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    days INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    FOREIGN KEY (prescriptionId) REFERENCES Prescription(id)
  );

  CREATE TABLE Treatment (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    visitId TEXT,
    doctorId TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'PLANNED',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE TreatmentPlan (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    doctorId TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    totalFee REAL DEFAULT 0,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE TreatmentPlanItem (
    id TEXT PRIMARY KEY,
    planId TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'PLANNED',
    FOREIGN KEY (planId) REFERENCES TreatmentPlan(id)
  );

  CREATE TABLE Imaging (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    imageUrl TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE MemberCard (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    cardNo TEXT UNIQUE NOT NULL,
    balance REAL DEFAULT 0,
    totalRecharge REAL DEFAULT 0,
    totalConsume REAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE MemberCardLog (
    id TEXT PRIMARY KEY,
    cardId TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balanceAfter REAL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cardId) REFERENCES MemberCard(id)
  );

  CREATE TABLE MemberPointLog (
    id TEXT PRIMARY KEY,
    cardId TEXT NOT NULL,
    type TEXT NOT NULL,
    points REAL NOT NULL,
    balanceAfter REAL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cardId) REFERENCES MemberCard(id)
  );

  CREATE TABLE InventoryItem (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    stock REAL DEFAULT 0,
    price REAL DEFAULT 0,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE InventoryTransaction (
    id TEXT PRIMARY KEY,
    itemId TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (itemId) REFERENCES InventoryItem(id)
  );

  CREATE TABLE Supplier (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contactPerson TEXT,
    phone TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE PurchaseOrderItem (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unitPrice REAL NOT NULL,
    subtotal REAL NOT NULL
  );

  CREATE TABLE Refund (
    id TEXT PRIMARY KEY,
    chargeId TEXT NOT NULL,
    patientId TEXT NOT NULL,
    amount REAL NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chargeId) REFERENCES Charge(id)
  );

  CREATE TABLE BackupRecord (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    fileSize INTEGER,
    type TEXT DEFAULT 'MANUAL',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE SmsLog (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE WechatMessage (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE Invoice (
    id TEXT PRIMARY KEY,
    number TEXT UNIQUE NOT NULL,
    patientId TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'ISSUED',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE OperationLog (
    id TEXT PRIMARY KEY,
    userId TEXT,
    action TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE OralExamination (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    examDate TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE PeriodontalRecord (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    examDate TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE FollowUp (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    planDate TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE FirstExam (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    examDate TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'DRAFT',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE ToothRecord (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    toothNumber INTEGER NOT NULL,
    currentStatus TEXT DEFAULT 'SOUND',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE Registration (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'REGISTERED',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE MedicalRecord (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    doctorId TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(id)
  );

  CREATE TABLE ProcessingFactory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

// 样本数据
function insertSampleData(db: Database.Database) {
  // 用户
  db.prepare(`INSERT INTO User (id, username, passwordHash, name, role) VALUES (?, ?, ?, ?, ?)`)
    .run('user-001', 'admin', 'hash123', '管理员', 'BOSS');
  db.prepare(`INSERT INTO User (id, username, passwordHash, name, role) VALUES (?, ?, ?, ?, ?)`)
    .run('user-002', 'doctor1', 'hash456', '张医生', 'DOCTOR');

  // 患者
  db.prepare(`INSERT INTO Patient (id, code, name, gender, phone) VALUES (?, ?, ?, ?, ?)`)
    .run('pat-001', 'P00001', '王小明', 'MALE', '13800001111');
  db.prepare(`INSERT INTO Patient (id, code, name, gender, phone) VALUES (?, ?, ?, ?, ?)`)
    .run('pat-002', 'P00002', '李小红', 'FEMALE', '13900002222');
  db.prepare(`INSERT INTO Patient (id, code, name, gender, phone) VALUES (?, ?, ?, ?, ?)`)
    .run('pat-003', 'P00003', '张大强', 'MALE', '13700003333');

  // 预约
  db.prepare(`INSERT INTO Appointment (id, patientId, doctorId, startTime, endTime, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('apt-001', 'pat-001', 'user-002', '2025-01-15 10:00', '2025-01-15 11:00', 'BOOKED');

  // 就诊
  db.prepare(`INSERT INTO Visit (id, patientId, doctorId, chiefComplaint, diagnosis) VALUES (?, ?, ?, ?, ?)`)
    .run('visit-001', 'pat-001', 'user-002', '牙痛', '龋齿');

  // 收费
  db.prepare(`INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('chg-001', 'pat-001', 'C000001', 500, 500, 'PAID');
  db.prepare(`INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('chg-002', 'pat-002', 'C000002', 200, 0, 'UNPAID');

  // 收费项目
  db.prepare(`INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('ci-001', 'chg-001', '洁牙', '治疗', 200, 1, 200);
  db.prepare(`INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('ci-002', 'chg-001', '补牙', '治疗', 300, 1, 300);

  // 处方
  db.prepare(`INSERT INTO Prescription (id, patientId, doctorId) VALUES (?, ?, ?)`)
    .run('rx-001', 'pat-001', 'user-002');
  db.prepare(`INSERT INTO PrescriptionItem (id, prescriptionId, drugName, spec, dosage, frequency, days, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('rxi-001', 'rx-001', '阿莫西林', '0.5g', '1粒', '每日3次', 7, 21, '粒');

  // 治疗
  db.prepare(`INSERT INTO Treatment (id, patientId, doctorId, code, name, category, price) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('treat-001', 'pat-001', 'user-002', 'T000001', '根管治疗', '治疗', 800);

  // 治疗计划
  db.prepare(`INSERT INTO TreatmentPlan (id, patientId, doctorId, name, status, totalFee) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('tp-001', 'pat-001', 'user-002', '正畸方案', 'ACTIVE', 15000);
  db.prepare(`INSERT INTO TreatmentPlanItem (id, planId, code, name, category, price) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('tpi-001', 'tp-001', 'TP000001', '托槽粘接', '治疗', 5000);

  // 影像
  db.prepare(`INSERT INTO Imaging (id, patientId, type, title, imageUrl) VALUES (?, ?, ?, ?, ?)`)
    .run('img-001', 'pat-001', 'XRAY', '全景片', '/images/xray1.jpg');

  // 会员卡
  db.prepare(`INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge) VALUES (?, ?, ?, ?, ?)`)
    .run('mc-001', 'pat-001', 'VIP001', 1000, 2000);
  db.prepare(`INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter) VALUES (?, ?, ?, ?, ?)`)
    .run('mcl-001', 'mc-001', 'RECHARGE', 1000, 1000);
  db.prepare(`INSERT INTO MemberPointLog (id, cardId, type, points, balanceAfter) VALUES (?, ?, ?, ?, ?)`)
    .run('mpl-001', 'mc-001', 'EARN', 100, 100);

  // 库存
  db.prepare(`INSERT INTO InventoryItem (id, code, name, category, unit, stock) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('inv-001', 'INV001', '一次性手套', '耗材', '盒', 100);
  db.prepare(`INSERT INTO InventoryTransaction (id, itemId, type, quantity) VALUES (?, ?, ?, ?)`)
    .run('invtx-001', 'inv-001', 'IN', 50);

  // 供应商
  db.prepare(`INSERT INTO Supplier (id, name, contactPerson) VALUES (?, ?, ?)`)
    .run('sup-001', '口腔耗材供应商', '赵经理');

  // 退款
  db.prepare(`INSERT INTO Refund (id, chargeId, patientId, amount) VALUES (?, ?, ?, ?)`)
    .run('ref-001', 'chg-001', 'pat-001', 100);

  // 备份记录
  db.prepare(`INSERT INTO BackupRecord (id, filename, fileSize, type) VALUES (?, ?, ?, ?)`)
    .run('bak-001', 'dental-2025-01-01.sqlite', 1048576, 'AUTO');

  // 操作日志
  db.prepare(`INSERT INTO OperationLog (id, userId, action) VALUES (?, ?, ?)`)
    .run('log-001', 'user-001', 'LOGIN');

  // 口腔检查
  db.prepare(`INSERT INTO OralExamination (id, patientId, examDate) VALUES (?, ?, ?)`)
    .run('oe-001', 'pat-001', '2025-01-10');

  // 牙周记录
  db.prepare(`INSERT INTO PeriodontalRecord (id, patientId, examDate) VALUES (?, ?, ?)`)
    .run('pr-001', 'pat-001', '2025-01-10');

  // 随访
  db.prepare(`INSERT INTO FollowUp (id, patientId, planDate, status) VALUES (?, ?, ?, ?)`)
    .run('fu-001', 'pat-001', '2025-02-01', 'PENDING');

  // 初诊
  db.prepare(`INSERT INTO FirstExam (id, patientId, status) VALUES (?, ?, ?)`)
    .run('fe-001', 'pat-003', 'DRAFT');

  // 牙位记录
  db.prepare(`INSERT INTO ToothRecord (id, patientId, toothNumber, currentStatus) VALUES (?, ?, ?, ?)`)
    .run('tr-001', 'pat-001', 11, 'CARIES');

  // 挂号
  db.prepare(`INSERT INTO Registration (id, patientId, type, status) VALUES (?, ?, ?, ?)`)
    .run('reg-001', 'pat-001', 'GENERAL', 'REGISTERED');

  // 病历
  db.prepare(`INSERT INTO MedicalRecord (id, patientId, doctorId) VALUES (?, ?, ?)`)
    .run('mr-001', 'pat-001', 'user-002');

  // 加工厂
  db.prepare(`INSERT INTO ProcessingFactory (id, name, status) VALUES (?, ?, ?)`)
    .run('pf-001', '义齿加工中心', 'ACTIVE');
}

// 迁移逻辑（从 migrations.ts 提取，直接操作传入的 db）
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return cols.some(c => c.name === column);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function createIndexIfNotExists(db: Database.Database, name: string, table: string, columns: string) {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
  } catch { /* ignore */ }
}

function migrateToV1(db: Database.Database) {
  addColumnIfMissing(db, 'User', 'passwordNeedsRehash', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'User', 'tokenVersion', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'User', 'refreshToken', 'TEXT');
  addColumnIfMissing(db, 'User', 'refreshTokenExpiresAt', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'idCard', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'occupation', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'avatar', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'tags', "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, 'Patient', 'allergies', "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, 'Patient', 'medicalHistory', "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, 'Patient', 'medicationHistory', "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, 'Patient', 'systemicDiseases', "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, 'Patient', 'source', "TEXT DEFAULT 'WALK_IN'");
  addColumnIfMissing(db, 'Patient', 'familyId', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'referrer', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'emergencyContact', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'emergencyPhone', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'remark', 'TEXT');
  addColumnIfMissing(db, 'Patient', 'openId', 'TEXT');
  addColumnIfMissing(db, 'Appointment', 'chairId', 'TEXT');
  addColumnIfMissing(db, 'Appointment', 'type', "TEXT DEFAULT 'CLEANING'");
  addColumnIfMissing(db, 'Appointment', 'remark', 'TEXT');
  addColumnIfMissing(db, 'Visit', 'createdAt', "TEXT DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing(db, 'Visit', 'updatedAt', "TEXT DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing(db, 'Prescription', 'updatedAt', "TEXT DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing(db, 'Charge', 'discount', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'Charge', 'payMethod', 'TEXT');
  addColumnIfMissing(db, 'Charge', 'paidAt', 'TEXT');
  addColumnIfMissing(db, 'Charge', 'remark', 'TEXT');
  addColumnIfMissing(db, 'User', 'phone', 'TEXT');
  addColumnIfMissing(db, 'User', 'loginAttempts', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'User', 'lockedUntil', 'TEXT');
  addColumnIfMissing(db, 'MemberCard', 'points', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'MemberCard', 'totalPoints', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'MemberCard', 'level', "TEXT DEFAULT 'NORMAL'");
}

function migrateToV2(db: Database.Database) {
  createIndexIfNotExists(db, 'idx_charge_doctor', 'Charge', 'doctorId');
  createIndexIfNotExists(db, 'idx_medical_record_created_at', 'MedicalRecord', 'createdAt');
  createIndexIfNotExists(db, 'idx_charge_patient_status', 'Charge', 'patientId, status');
  createIndexIfNotExists(db, 'idx_medical_record_doctor', 'MedicalRecord', 'doctorId');

  const tablesNeedUpdatedAt = [
    'ChargeItem', 'TreatmentPlanItem', 'PrescriptionItem', 'PurchaseOrderItem',
    'MemberCardLog', 'MemberPointLog', 'InventoryTransaction', 'OperationLog',
    'BackupRecord', 'SmsLog', 'WechatMessage', 'Refund', 'Invoice',
  ];
  tablesNeedUpdatedAt.forEach(table => {
    addColumnIfMissing(db, table, 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  });
}

function migrateToV3(db: Database.Database) {
  const tablesNeedDeletedAt = [
    'MedicalRecord', 'Patient', 'Appointment', 'Prescription', 'PrescriptionItem',
    'Visit', 'Treatment', 'TreatmentPlan', 'TreatmentPlanItem', 'Imaging',
    'OralExamination', 'PeriodontalRecord', 'Charge', 'ChargeItem', 'Refund',
    'MemberCard', 'Registration', 'FollowUp', 'FirstExam', 'ToothRecord',
    'InventoryItem', 'Supplier', 'ProcessingFactory',
  ];
  tablesNeedDeletedAt.forEach(table => {
    addColumnIfMissing(db, table, 'deletedAt', 'TEXT');
    const idxName = `idx_${table.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2')}_deleted`;
    createIndexIfNotExists(db, idxName, table, 'deletedAt');
  });
}

// ===== 测试执行 =====
interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  results.push({ name, passed: condition, detail });
  if (!condition) {
    console.error(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
  } else {
    console.log(`  PASS: ${name}`);
  }
}

function runTests() {
  console.log('=== 数据库迁移 v0→v3 测试 ===\n');

  // 准备临时目录
  fs.mkdirSync(tmpDir, { recursive: true });

  // Step 1: 创建 v0 数据库
  console.log('[Step 1] 创建 v0 初始 schema...');
  const db = new Database(tmpDbPath, dbOptions);
  db.pragma('journal_mode = WAL');
  db.exec(V0_SCHEMA);
  db.pragma('user_version = 0');

  // Step 2: 插入样本数据
  console.log('[Step 2] 插入样本数据...');
  insertSampleData(db);

  // 记录迁移前各表数据量
  const tablesBeforeMigration = [
    'User', 'Patient', 'Appointment', 'Visit', 'Charge', 'ChargeItem',
    'Prescription', 'PrescriptionItem', 'Treatment', 'TreatmentPlan',
    'TreatmentPlanItem', 'Imaging', 'MemberCard', 'MemberCardLog',
    'MemberPointLog', 'InventoryItem', 'InventoryTransaction', 'Supplier',
    'Refund', 'BackupRecord', 'OperationLog', 'OralExamination',
    'PeriodontalRecord', 'FollowUp', 'FirstExam', 'ToothRecord',
    'Registration', 'MedicalRecord', 'ProcessingFactory',
  ];

  const countsBefore = new Map<string, number>();
  for (const table of tablesBeforeMigration) {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    countsBefore.set(table, row.cnt);
  }
  console.log(`  共 ${tablesBeforeMigration.length} 张表，数据量已记录`);

  // Step 3: 执行迁移 v1
  console.log('\n[Step 3] 执行 v1 迁移...');
  try {
    migrateToV1(db);
    db.pragma('user_version = 1');
    assert(true, 'v1 迁移成功执行');
  } catch (err) {
    assert(false, 'v1 迁移成功执行', (err as Error).message);
  }

  // Step 4: 执行迁移 v2
  console.log('[Step 4] 执行 v2 迁移...');
  try {
    migrateToV2(db);
    db.pragma('user_version = 2');
    assert(true, 'v2 迁移成功执行');
  } catch (err) {
    assert(false, 'v2 迁移成功执行', (err as Error).message);
  }

  // Step 5: 执行迁移 v3
  console.log('[Step 5] 执行 v3 迁移...');
  try {
    migrateToV3(db);
    db.pragma('user_version = 3');
    assert(true, 'v3 迁移成功执行');
  } catch (err) {
    assert(false, 'v3 迁移成功执行', (err as Error).message);
  }

  // Step 6: 验证数据完整性
  console.log('\n[Step 6] 验证数据完整性...');
  for (const [table, expectedCount] of countsBefore) {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    assert(
      row.cnt === expectedCount,
      `${table} 数据量一致 (${row.cnt} === ${expectedCount})`,
    );
  }

  // Step 7: 验证新增列存在且有默认值
  console.log('\n[Step 7] 验证新增列...');

  // v1 新增列
  const v1Checks = [
    { table: 'User', col: 'passwordNeedsRehash' },
    { table: 'User', col: 'tokenVersion' },
    { table: 'User', col: 'loginAttempts' },
    { table: 'User', col: 'lockedUntil' },
    { table: 'User', col: 'phone' },
    { table: 'Patient', col: 'tags' },
    { table: 'Patient', col: 'source' },
    { table: 'Patient', col: 'allergies' },
    { table: 'Appointment', col: 'chairId' },
    { table: 'Appointment', col: 'type' },
    { table: 'Visit', col: 'createdAt' },
    { table: 'Visit', col: 'updatedAt' },
    { table: 'Charge', col: 'discount' },
    { table: 'Charge', col: 'payMethod' },
    { table: 'MemberCard', col: 'points' },
    { table: 'MemberCard', col: 'level' },
  ];
  for (const { table, col } of v1Checks) {
    assert(columnExists(db, table, col), `v1: ${table}.${col} 列存在`);
  }

  // v2 新增列
  const v2Tables = [
    'ChargeItem', 'TreatmentPlanItem', 'PrescriptionItem', 'PurchaseOrderItem',
    'MemberCardLog', 'MemberPointLog', 'InventoryTransaction', 'OperationLog',
    'BackupRecord', 'SmsLog', 'WechatMessage', 'Refund', 'Invoice',
  ];
  for (const table of v2Tables) {
    assert(columnExists(db, table, 'updatedAt'), `v2: ${table}.updatedAt 列存在`);
  }

  // v3 新增列
  const v3Tables = [
    'MedicalRecord', 'Patient', 'Appointment', 'Prescription', 'PrescriptionItem',
    'Visit', 'Treatment', 'TreatmentPlan', 'TreatmentPlanItem', 'Imaging',
    'OralExamination', 'PeriodontalRecord', 'Charge', 'ChargeItem', 'Refund',
    'MemberCard', 'Registration', 'FollowUp', 'FirstExam', 'ToothRecord',
    'InventoryItem', 'Supplier', 'ProcessingFactory',
  ];
  for (const table of v3Tables) {
    assert(columnExists(db, table, 'deletedAt'), `v3: ${table}.deletedAt 列存在`);
  }

  // Step 8: 验证默认值正确
  console.log('\n[Step 8] 验证默认值...');
  const patient = db.prepare('SELECT source, tags FROM Patient WHERE id = ?').get('pat-001') as any;
  assert(patient.source === 'WALK_IN', 'Patient.source 默认值 WALK_IN', `实际: ${patient.source}`);
  assert(patient.tags === '[]', 'Patient.tags 默认值 []', `实际: ${patient.tags}`);

  const charge = db.prepare('SELECT discount FROM Charge WHERE id = ?').get('chg-001') as any;
  assert(charge.discount === 0, 'Charge.discount 默认值 0', `实际: ${charge.discount}`);

  const memberCard = db.prepare('SELECT points, level FROM MemberCard WHERE id = ?').get('mc-001') as any;
  assert(memberCard.points === 0, 'MemberCard.points 默认值 0', `实际: ${memberCard.points}`);
  assert(memberCard.level === 'NORMAL', 'MemberCard.level 默认值 NORMAL', `实际: ${memberCard.level}`);

  const appointment = db.prepare('SELECT type FROM Appointment WHERE id = ?').get('apt-001') as any;
  assert(appointment.type === 'CLEANING', 'Appointment.type 默认值 CLEANING', `实际: ${appointment.type}`);

  // Step 9: 验证索引存在
  console.log('\n[Step 9] 验证索引...');
  const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[];
  const indexNames = new Set(indexes.map(i => i.name));

  const expectedIndexes = [
    'idx_charge_doctor',
    'idx_medical_record_created_at',
    'idx_charge_patient_status',
    'idx_medical_record_doctor',
    'idx_patient_deleted',
    'idx_charge_deleted',
    'idx_visit_deleted',
  ];
  for (const idx of expectedIndexes) {
    assert(indexNames.has(idx), `索引 ${idx} 存在`);
  }

  // Step 10: 验证 PRAGMA integrity_check
  console.log('\n[Step 10] 完整性检查...');
  const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
  const integrityOk = integrity.every(r => r.integrity_check === 'ok');
  assert(integrityOk, 'PRAGMA integrity_check 通过');

  // Step 11: 验证幂等性 — 重复执行迁移不应出错
  console.log('\n[Step 11] 验证幂等性（重复执行迁移）...');
  try {
    migrateToV1(db);
    migrateToV2(db);
    migrateToV3(db);
    assert(true, '重复执行 v1+v2+v3 无错误');
  } catch (err) {
    assert(false, '重复执行 v1+v2+v3 无错误', (err as Error).message);
  }

  // 幂等性后再次验证数据量
  for (const [table, expectedCount] of countsBefore) {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    assert(
      row.cnt === expectedCount,
      `幂等性后 ${table} 数据量一致 (${row.cnt} === ${expectedCount})`,
    );
  }

  // Step 12: 验证 user_version
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  assert(version === 3, `user_version = 3`, `实际: ${version}`);

  // 清理
  db.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  // 输出总结
  console.log('\n=== 测试结果 ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`总计: ${results.length} | 通过: ${passed} | 失败: ${failed}`);

  if (failed > 0) {
    console.log('\n失败项:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    });
    process.exit(1);
  } else {
    console.log('\n所有测试通过!');
    process.exit(0);
  }
}

runTests();
