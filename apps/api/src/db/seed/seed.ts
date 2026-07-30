/* eslint-disable security/detect-non-literal-fs-filename -- 种子数据路径来自配置常量，非用户输入 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { createDbConnection, initDb, getDbPath } from '../database';
import {
  createAdmin,
  createDoctor,
  createReceptionist,
  createPatients,
  createAppointments,
  createCharges,
  createInventoryItems,
  createMemberCards,
  resetPatientCodeCounter,
  resetChargeNumberCounter,
  resetInventoryItemCodeCounter,
  resetMemberCardNoCounter,
  SEED_SUPPLIERS,
} from './factories';

export interface SeedOptions {
  fresh?: boolean;
  count?: {
    patients?: number;
    appointments?: number;
    charges?: number;
    inventoryItems?: number;
    memberCards?: number;
  };
  clinicName?: string;
}

const DEFAULT_COUNTS = {
  patients: 50,
  appointments: 100,
  charges: 50,
  inventoryItems: 50,
  memberCards: 20,
};

const CHAIR_NAMES = [
  { name: '1号牙椅', location: '一楼A诊室' },
  { name: '2号牙椅', location: '一楼B诊室' },
  { name: '3号牙椅', location: '二楼C诊室' },
  { name: '4号牙椅', location: '二楼D诊室' },
  { name: '5号牙椅', location: '三楼VIP诊室' },
];

const TREATMENT_CATALOG = [
  { code: 'T001', name: '洗牙', category: '预防保健', price: 120 },
  { code: 'T002', name: '补牙', category: '修复治疗', price: 150 },
  { code: 'T003', name: '根管治疗', category: '牙髓治疗', price: 500 },
  { code: 'T004', name: '牙齿美白', category: '美容修复', price: 800 },
  { code: 'T005', name: '拔牙', category: '口腔外科', price: 200 },
  { code: 'T006', name: '种植牙', category: '修复治疗', price: 5000 },
  { code: 'T007', name: '正畸咨询', category: '正畸治疗', price: 200 },
  { code: 'T008', name: '牙周治疗', category: '牙周病', price: 300 },
  { code: 'T009', name: '儿童齿科', category: '预防保健', price: 100 },
  { code: 'T010', name: 'X光检查', category: '影像学', price: 150 },
  { code: 'T011', name: 'CT检查', category: '影像学', price: 300 },
  { code: 'T012', name: '口腔检查', category: '预防保健', price: 50 },
  { code: 'T013', name: '义齿修复', category: '修复治疗', price: 1200 },
  { code: 'T014', name: '贴面修复', category: '美容修复', price: 1500 },
  { code: 'T015', name: '咬合调整', category: '修复治疗', price: 300 },
];

const PAYMENT_METHODS = [
  { code: 'CASH', name: '现金', sortOrder: 1 },
  { code: 'WECHAT', name: '微信支付', sortOrder: 2 },
  { code: 'ALIPAY', name: '支付宝', sortOrder: 3 },
  { code: 'CARD', name: '银行卡', sortOrder: 4 },
  { code: 'MEMBER_CARD', name: '会员卡', sortOrder: 5 },
  { code: 'INSURANCE', name: '医保', sortOrder: 6 },
];

function resetCounters(): void {
  resetPatientCodeCounter();
  resetChargeNumberCounter();
  resetInventoryItemCodeCounter();
  resetMemberCardNoCounter();
}

function createClinic(db: DatabaseType, name: string): string {
  const id = crypto.randomUUID();
  const code = `CLINIC-${name.slice(0, 4).toUpperCase()}`;
  db.prepare(
    'INSERT INTO Clinic (id, name, code, address, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(
    id,
    name,
    code,
    '',
    '',
    new Date().toISOString(),
    new Date().toISOString(),
  );
  return id;
}

function createChairs(db: DatabaseType, clinicId: string): Array<{ id: string }> {
  const chairs: Array<{ id: string }> = [];
  const stmt = db.prepare(
    'INSERT INTO Chair (id, name, location, active, clinicId, createdAt) VALUES (?, ?, ?, 1, ?, ?)',
  );
  CHAIR_NAMES.forEach((c, _i) => {
    const id = crypto.randomUUID();
    stmt.run(id, c.name, c.location, clinicId, new Date().toISOString());
    chairs.push({ id });
  });
  return chairs;
}

function createTreatmentCatalog(db: DatabaseType, clinicId: string): void {
  // 首启初始化（db/seeds.ts）已预置 tc-1..15，这里用 upsert 覆盖为演示数据（价格以分存储），避免主键冲突
  const stmt = db.prepare(
    `INSERT INTO TreatmentCatalog (id, code, name, category, price, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, category = excluded.category, price = excluded.price, clinicId = excluded.clinicId`,
  );
  TREATMENT_CATALOG.forEach((t, i) => {
    stmt.run(
      `tc-${i + 1}`,
      t.code,
      t.name,
      t.category,
      t.price * 100,
      clinicId,
      new Date().toISOString(),
    );
  });
}

function createPaymentMethods(db: DatabaseType, clinicId: string): void {
  const stmt = db.prepare(
    'INSERT INTO PaymentMethod (id, code, name, sortOrder, isEnabled, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  );
  PAYMENT_METHODS.forEach((pm, _i) => {
    stmt.run(
      crypto.randomUUID(),
      pm.code,
      pm.name,
      pm.sortOrder,
      clinicId,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  });
}

function createSuppliers(db: DatabaseType, clinicId: string): void {
  const stmt = db.prepare(
    'INSERT INTO Supplier (id, name, contactPerson, phone, address, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  SEED_SUPPLIERS.forEach((s) => {
    stmt.run(
      s.id,
      s.name,
      '联系人',
      '13800000000',
      '供应商地址',
      clinicId,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  });
}

function insertUsers(db: DatabaseType, clinicId: string): { doctors: Array<{ id: string }> } {
  const admin = createAdmin(clinicId);
  const doctors: Array<{ id: string }> = [];

  const insertUser = db.prepare(`
    INSERT INTO User (id, username, passwordHash, name, role, phone, active, clinicId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    admin.id,
    admin.username,
    admin.passwordHash,
    admin.name,
    admin.role,
    admin.phone,
    admin.active,
    admin.clinicId,
    admin.createdAt,
    admin.updatedAt,
  );

  for (let i = 0; i < 2; i++) {
    const doctor = createDoctor(clinicId);
    insertUser.run(
      doctor.id,
      doctor.username,
      doctor.passwordHash,
      doctor.name,
      doctor.role,
      doctor.phone,
      doctor.active,
      doctor.clinicId,
      doctor.createdAt,
      doctor.updatedAt,
    );
    doctors.push({ id: doctor.id });
  }

  const receptionist = createReceptionist(clinicId);
  insertUser.run(
    receptionist.id,
    receptionist.username,
    receptionist.passwordHash,
    receptionist.name,
    receptionist.role,
    receptionist.phone,
    receptionist.active,
    receptionist.clinicId,
    receptionist.createdAt,
    receptionist.updatedAt,
  );

  return { doctors };
}

function insertPatients(db: DatabaseType, clinicId: string, count: number): Array<{ id: string }> {
  const patients = createPatients(count, { clinicId });
  const stmt = db.prepare(`
    INSERT INTO Patient (
      id, code, name, gender, birthDate, phone, idCard, address, occupation,
      remark, tags, allergies, medicalHistory, medicationHistory, systemicDiseases,
      source, emergencyContact, emergencyPhone, clinicId, active, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((patientsData: typeof patients) => {
    for (const p of patientsData) {
      stmt.run(
        p.id,
        p.code,
        p.name,
        p.gender,
        p.birthDate,
        p.phone,
        p.idCard,
        p.address,
        p.occupation,
        p.remark,
        p.tags,
        p.allergies,
        p.medicalHistory,
        p.medicationHistory,
        p.systemicDiseases,
        p.source,
        p.emergencyContact,
        p.emergencyPhone,
        p.clinicId,
        p.active,
        p.createdAt,
        p.updatedAt,
      );
    }
  });

  tx(patients);
  return patients.map((p) => ({ id: p.id }));
}

function insertAppointments(
  db: DatabaseType,
  clinicId: string,
  count: number,
  patients: Array<{ id: string }>,
  doctors: Array<{ id: string }>,
  chairs: Array<{ id: string }>,
): void {
  const appointments = createAppointments(count, { clinicId, patients, doctors, chairs });
  const stmt = db.prepare(`
    INSERT INTO Appointment (
      id, patientId, doctorId, chairId, startTime, endTime, status, type,
      remark, visitId, clinicId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((appointmentsData: typeof appointments) => {
    for (const a of appointmentsData) {
      stmt.run(
        a.id,
        a.patientId,
        a.doctorId,
        a.chairId,
        a.startTime,
        a.endTime,
        a.status,
        a.type,
        a.remark,
        a.visitId,
        a.clinicId,
        a.createdAt,
        a.updatedAt,
      );
    }
  });

  tx(appointments);
}

function insertCharges(
  db: DatabaseType,
  clinicId: string,
  count: number,
  patients: Array<{ id: string }>,
  doctors: Array<{ id: string }>,
): void {
  const charges = createCharges(count, { clinicId, patients, doctors });
  const chargeStmt = db.prepare(`
    INSERT INTO Charge (
      id, patientId, visitId, doctorId, number, totalAmount, paidAmount,
      refundedAmount, discount, status, payMethod, paidAt, remark,
      clinicId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const itemStmt = db.prepare(`
    INSERT INTO ChargeItem (
      id, chargeId, treatmentId, inventoryItemId, name, category, price,
      quantity, teethNumbers, subtotal, clinicId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((chargesData: typeof charges) => {
    for (const c of chargesData) {
      chargeStmt.run(
        c.id,
        c.patientId,
        c.visitId,
        c.doctorId,
        c.number,
        c.totalAmount,
        c.paidAmount,
        c.refundedAmount,
        c.discount,
        c.status,
        c.payMethod,
        c.paidAt,
        c.remark,
        c.clinicId,
        c.createdAt,
        c.updatedAt,
      );
      for (const item of c.items) {
        itemStmt.run(
          item.id,
          item.chargeId,
          item.treatmentId,
          item.inventoryItemId,
          item.name,
          item.category,
          item.price,
          item.quantity,
          item.teethNumbers,
          item.subtotal,
          item.clinicId,
          item.createdAt,
          item.updatedAt,
        );
      }
    }
  });

  tx(charges);
}

function insertInventoryItems(db: DatabaseType, clinicId: string, count: number): void {
  const items = createInventoryItems(count, { clinicId });
  const stmt = db.prepare(`
    INSERT INTO InventoryItem (
      id, code, name, spec, category, unit, stock, minStock, price,
      supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((itemsData: typeof items) => {
    for (const item of itemsData) {
      stmt.run(
        item.id,
        item.code,
        item.name,
        item.spec,
        item.category,
        item.unit,
        item.stock,
        item.minStock,
        item.price,
        item.supplierId,
        item.expireDate,
        item.location,
        item.remark,
        item.clinicId,
        item.createdAt,
        item.updatedAt,
      );
    }
  });

  tx(items);
}

function insertMemberCards(
  db: DatabaseType,
  clinicId: string,
  count: number,
  patients: Array<{ id: string }>,
): void {
  const cards = createMemberCards(count, { clinicId, patients });
  const stmt = db.prepare(`
    INSERT INTO MemberCard (
      id, patientId, cardNo, balance, totalRecharge, totalConsume,
      points, totalPoints, level, status, clinicId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((cardsData: typeof cards) => {
    for (const c of cardsData) {
      stmt.run(
        c.id,
        c.patientId,
        c.cardNo,
        c.balance,
        c.totalRecharge,
        c.totalConsume,
        c.points,
        c.totalPoints,
        c.level,
        c.status,
        c.clinicId,
        c.createdAt,
        c.updatedAt,
      );
    }
  });

  tx(cards);
}

function insertClinicInfo(db: DatabaseType, clinicId: string, clinicName: string): void {
  const clinicInfo = [
    { key: 'name', value: clinicName },
    { key: 'phone', value: '010-12345678' },
    { key: 'address', value: '北京市朝阳区建国路88号' },
    { key: 'logo', value: '' },
  ];
  // 首启初始化（db/seeds.ts）已预置 info-1..4，这里用 upsert 覆盖为演示诊所信息，避免主键冲突
  const stmt = db.prepare(
    `INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET key = excluded.key, value = excluded.value, clinicId = excluded.clinicId, updatedAt = excluded.updatedAt`,
  );
  clinicInfo.forEach((c, i) => {
    stmt.run(
      `info-${i + 1}`,
      c.key,
      c.value,
      clinicId,
      new Date().toISOString(),
    );
  });
}

export function runSeed(options: SeedOptions = {}): void {
  const {
    fresh = false,
    count = {},
    clinicName = '演示诊所',
  } = options;

  const counts = { ...DEFAULT_COUNTS, ...count };

  resetCounters();

  let db: DatabaseType;

  if (fresh) {
    if (process.env.TEST_DB_MEMORY === '1') {
      db = new Database(':memory:');
      initDb(db);
    } else {
      const dbPath = getDbPath();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        const walPath = dbPath + '-wal';
        const shmPath = dbPath + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
      }
      db = createDbConnection();
    }
  } else {
    db = createDbConnection();
  }

  console.log(`\n=== 开始生成种子数据 ===`);
  console.log(`诊所名称: ${clinicName}`);
  console.log(`患者数量: ${counts.patients}`);
  console.log(`预约数量: ${counts.appointments}`);
  console.log(`收费单数量: ${counts.charges}`);
  console.log(`库存物品数量: ${counts.inventoryItems}`);
  console.log(`会员卡数量: ${counts.memberCards}\n`);

  const startTime = Date.now();

  db.transaction(() => {
    const clinicId = createClinic(db, clinicName);
    console.log(`✓ 创建诊所: ${clinicName}`);

    insertClinicInfo(db, clinicId, clinicName);
    console.log('✓ 创建诊所信息');

    const { doctors } = insertUsers(db, clinicId);
    console.log('✓ 创建用户: 1个管理员 + 2个医生 + 1个前台');

    const chairs = createChairs(db, clinicId);
    console.log(`✓ 创建${chairs.length}个牙椅`);

    createTreatmentCatalog(db, clinicId);
    console.log('✓ 创建治疗项目目录');

    createPaymentMethods(db, clinicId);
    console.log('✓ 创建支付方式');

    createSuppliers(db, clinicId);
    console.log('✓ 创建供应商');

    const patients = insertPatients(db, clinicId, counts.patients);
    console.log(`✓ 创建${patients.length}个患者`);

    insertAppointments(db, clinicId, counts.appointments, patients, doctors, chairs);
    console.log(`✓ 创建${counts.appointments}个预约`);

    insertCharges(db, clinicId, counts.charges, patients, doctors);
    console.log(`✓ 创建${counts.charges}个收费单`);

    insertInventoryItems(db, clinicId, counts.inventoryItems);
    console.log(`✓ 创建${counts.inventoryItems}个库存物品`);

    insertMemberCards(db, clinicId, counts.memberCards, patients);
    console.log(`✓ 创建${counts.memberCards}张会员卡`);
  })();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== 种子数据生成完成 (耗时 ${duration}s) ===`);

  db.close();
}

function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  const options: SeedOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fresh') {
      options.fresh = true;
    } else if (arg === '--clinic' && i + 1 < args.length) {
      options.clinicName = args[i + 1];
      i++;
    } else if (arg === '--count' && i + 1 < args.length) {
      const countVal = parseInt(args[i + 1], 10);
      if (!isNaN(countVal) && countVal > 0) {
        options.count = {
          patients: countVal,
          appointments: countVal * 2,
          charges: countVal,
          inventoryItems: countVal,
          memberCards: Math.floor(countVal * 0.4),
        };
      }
      i++;
    }
  }

  return options;
}

if (require.main === module) {
  const options = parseArgs();
  runSeed(options);
}
