import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, seedDatabase } from '../src/server/infrastructure/database';
import { runMigrations } from '../src/server/infrastructure/migrations';
import { rebuildSearchIndex } from '../src/server/infrastructure/search-index';

process.env.V2_ADMIN_PASSWORD ??= 'v2-sim-admin-password';

const targetDir = process.env.V2_SIM_DATA_DIR
  ? path.resolve(process.env.V2_SIM_DATA_DIR)
  : path.resolve('data', 'simulated-clinic');
fs.mkdirSync(targetDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(targetDir, `v2.sqlite${suffix}`), { force: true });
}

const db = createDatabase(targetDir);
seedDatabase(db);
runMigrations(db);

const clinicId = 'clinic-v2-001';
const adminId = 'user-admin-001';
const now = new Date().toISOString();
const DAY_MS = 86_400_000;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const rand = mulberry32(20260809);
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
const daysAgoIso = (days: number, hour = 9): string => {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const SURNAMES = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴'];
const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '秀英', '霞', '平', '刚'];
const TREATMENTS = ['根管治疗', '洁牙', '拔牙', '充填', '冠修复', '种植一期', '正畸复诊', '牙周基础治疗'];
const COMPLAINTS = ['牙痛三天', '刷牙出血', '牙齿发黑', '缺牙咨询', '定期复查', '种植咨询', '正畸复诊', '牙龈肿痛'];
const CATEGORIES = ['EXAM', 'TREATMENT', 'MATERIAL', 'SERVICE'];
const STATUSES = ['PAID', 'PAID', 'PAID', 'PARTIAL', 'UNPAID', 'REFUNDED', 'CANCELLED'];
const APPOINTMENT_STATUSES = ['BOOKED', 'BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const FOLLOWUP_STATUSES = ['PENDING', 'PENDING', 'COMPLETED', 'COMPLETED', 'IN_PROGRESS'];

const LARGE_SCALE = process.env.V2_SIM_SCALE === 'large';
const DOCTOR_COUNT = 20;
const PATIENT_COUNT = LARGE_SCALE ? 100_000 : 2000;
const APPOINTMENT_COUNT = LARGE_SCALE ? 100_000 : 3000;
const VISIT_COUNT = LARGE_SCALE ? 60_000 : 1500;
const CHARGE_COUNT = LARGE_SCALE ? 100_000 : 4000;
const SUPPLIER_COUNT = LARGE_SCALE ? 500 : 100;
const INVENTORY_COUNT = LARGE_SCALE ? 2000 : 300;
const MEMBER_CARD_COUNT = LARGE_SCALE ? 30_000 : 600;
const PURCHASE_ORDER_COUNT = LARGE_SCALE ? 10_000 : 300;
const FOLLOWUP_COUNT = LARGE_SCALE ? 100_000 : 3000;

const doctorIds: string[] = [];
db.transaction(() => {
  const insertDoctor = db.prepare(
    `INSERT INTO User (
       id, clinicId, createdAt, updatedAt, deletedAt,
       username, passwordHash, name, role, active, loginAttempts, tokenVersion
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'DOCTOR', 1, 0, 0)`,
  );
  for (let i = 0; i < DOCTOR_COUNT; i += 1) {
    const id = `user-sim-doctor-${i}`;
    doctorIds.push(id);
    insertDoctor.run(id, clinicId, now, now, `doctor${String(i).padStart(2, '0')}`, 'simulated', `模拟医生${i + 1}`);
  }
})();

const patientIds: string[] = [];
db.transaction(() => {
  const insertPatient = db.prepare(
    `INSERT INTO Patient (
       id, clinicId, createdAt, updatedAt, deletedAt,
       code, name, gender, phone, wechatId, preferredContact, contactNote,
       birthDate, idCard, address, occupation, remark, avatar,
       tags, allergies, medicalHistory, medicationHistory, systemicDiseases,
       source, active, isTempPatient
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
       '[]', '[]', '[]', '[]', '[]', ?, 1, 0)`,
  );
  for (let i = 0; i < PATIENT_COUNT; i += 1) {
    const id = `sim-patient-${i}`;
    patientIds.push(id);
    const name = `${pick(SURNAMES)}${pick(GIVEN)}`;
    const gender = rand() < 0.5 ? 'MALE' : 'FEMALE';
    const phone = `13${String(100_000_000 + i).padStart(9, '0')}`;
    const wechatId = rand() < 0.7 ? `wx_sim_${i}` : null;
    const preferredContact = rand() < 0.5 ? 'PHONE' : 'WECHAT';
    const source = pick(['WALK_IN', 'REFERRAL', 'ONLINE', 'OTHER']);
    const birthYear = 1950 + Math.floor(rand() * 60);
    const birthDate = `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
    insertPatient.run(
      id, clinicId, now, now, `P${String(i).padStart(6, '0')}`, name, gender, phone, wechatId, preferredContact,
      rand() < 0.3 ? '下午联系' : null, birthDate, `SIM-${100000 + i}`, '模拟地址', pick(['职员', '教师', '个体', '退休']),
      rand() < 0.2 ? '模拟备注' : null, source,
    );
  }
})();

const appointmentIds: string[] = [];
db.transaction(() => {
  const insertAppointment = db.prepare(
    `INSERT INTO Appointment (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, doctorId, startTime, endTime, status, type, remark
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  for (let i = 0; i < APPOINTMENT_COUNT; i += 1) {
    const id = `sim-appt-${i}`;
    appointmentIds.push(id);
    const patientId = patientIds[Math.floor(rand() * patientIds.length)];
    const doctorId = doctorIds[Math.floor(rand() * doctorIds.length)];
    const dayOffset = Math.floor(rand() * 90) - 45;
    const start = new Date(Date.now() - dayOffset * DAY_MS);
    start.setHours(8 + Math.floor(rand() * 9), Math.floor(rand() * 4) * 15, 0, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    insertAppointment.run(
      id, clinicId, now, now, patientId, doctorId, start.toISOString(), end.toISOString(),
      pick(APPOINTMENT_STATUSES), pick(['REGULAR', 'FOLLOW_UP', 'EMERGENCY', 'CONSULTATION']),
    );
  }
})();

const visitIds: string[] = [];
db.transaction(() => {
  const insertVisit = db.prepare(
    `INSERT INTO Visit (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, appointmentId, doctorId, chiefComplaint, diagnosis, treatmentPlan, summary,
       startTime, endTime, status, nextReminder
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < VISIT_COUNT; i += 1) {
    const id = `sim-visit-${i}`;
    visitIds.push(id);
    const appointment = appointmentIds[Math.floor(rand() * appointmentIds.length)];
    const patientId = patientIds[Math.floor(rand() * patientIds.length)];
    const doctorId = doctorIds[Math.floor(rand() * doctorIds.length)];
    const start = daysAgoIso(Math.floor(rand() * 60), 9 + Math.floor(rand() * 5));
    const end = new Date(new Date(start).getTime() + 45 * 60_000).toISOString();
    insertVisit.run(
      id, clinicId, now, now, patientId, appointment, doctorId, pick(COMPLAINTS), pick(TREATMENTS),
      pick(TREATMENTS), pick(TREATMENTS), start, end, rand() < 0.85 ? 'COMPLETED' : 'IN_PROGRESS',
      rand() < 0.3 ? '7天后复诊' : null,
    );
  }
})();

db.transaction(() => {
  const insertCharge = db.prepare(
    `INSERT INTO Charge (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
       discount, status, payMethod, payMethodName, paidAt, remark, discountPlanSnapshotJson
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, '{}')`,
  );
  const insertItem = db.prepare(
    `INSERT INTO ChargeItem (
       id, chargeId, treatmentId, name, category, price, quantity, teethNumbers, subtotal,
       clinicId, createdAt, updatedAt, deletedAt, costType
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, '[]', ?, ?, ?, ?, NULL, ?)`,
  );
  for (let i = 0; i < CHARGE_COUNT; i += 1) {
    const id = `sim-charge-${i}`;
    const patientId = patientIds[Math.floor(rand() * patientIds.length)];
    const visitId = rand() < 0.7 ? visitIds[Math.floor(rand() * visitIds.length)] : null;
    const doctorId = doctorIds[Math.floor(rand() * doctorIds.length)];
    const itemCount = 1 + Math.floor(rand() * 3);
    let total = 0;
    const items: Array<{ name: string; category: string; price: number; quantity: number; subtotal: number; costType: string }> = [];
    for (let j = 0; j < itemCount; j += 1) {
      const price = (500 + Math.floor(rand() * 30000)) * 100;
      const quantity = 1;
      const subtotal = price * quantity;
      total += subtotal;
      items.push({ name: pick(TREATMENTS), category: pick(CATEGORIES), price, quantity, subtotal, costType: rand() < 0.5 ? 'SERVICE' : 'MATERIAL' });
    }
    const status = pick(STATUSES);
    const paidAmount = status === 'PAID' ? total : status === 'PARTIAL' ? Math.floor(total / 2) : 0;
    const refundedAmount = status === 'REFUNDED' ? Math.floor(total / 2) : 0;
    const paidAt = paidAmount > 0 ? now : null;
    insertCharge.run(
      id, clinicId, now, now, patientId, visitId, doctorId, `SIM-C-${String(i).padStart(6, '0')}`,
      total, paidAmount, refundedAmount, status, pick(['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'MEMBER_CARD', 'OTHER']),
      paidAt ? '模拟支付' : null, paidAt,
    );
    for (const item of items) {
      insertItem.run(randomUUID(), id, item.name, item.category, item.price, item.quantity, item.subtotal, clinicId, now, now, item.costType);
    }
  }
})();

const supplierIds: string[] = [];
db.transaction(() => {
  const insertSupplier = db.prepare(
    `INSERT INTO Supplier (
       id, clinicId, createdAt, updatedAt, deletedAt,
       code, name, contactPerson, phone, address, bankAccount, remark
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  for (let i = 0; i < SUPPLIER_COUNT; i += 1) {
    const id = `sim-supplier-${i}`;
    supplierIds.push(id);
    insertSupplier.run(id, clinicId, now, now, `SUP-${i}`, `模拟供应商${i + 1}`, `联系人${i + 1}`, `136${String(100_000_000 + i).slice(0, 8)}`, '模拟地址', '6222000000000000000');
  }
})();

const inventoryIds: string[] = [];
db.transaction(() => {
  const insertItem = db.prepare(
    `INSERT INTO InventoryItem (
       id, clinicId, createdAt, updatedAt, deletedAt,
       code, name, spec, category, unit, stock, minStock, price, supplierId,
       expireDate, location, remark, batchManaged, isHighValue, catalogId
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, NULL)`,
  );
  const insertTx = db.prepare(
    `INSERT INTO InventoryTransaction (
       id, clinicId, createdAt, updatedAt, deletedAt,
       itemId, type, quantity, beforeStock, afterStock, referenceType, referenceId,
       operatorId, remark, batchId
     ) VALUES (?, ?, ?, ?, NULL, ?, 'IN', ?, 0, ?, NULL, NULL, ?, NULL, NULL)`,
  );
  for (let i = 0; i < INVENTORY_COUNT; i += 1) {
    const id = `sim-inventory-${i}`;
    inventoryIds.push(id);
    const stock = Math.floor(rand() * 1000);
    const minStock = Math.floor(rand() * 100);
    const price = (100 + Math.floor(rand() * 10000)) * 100;
    insertItem.run(
      id, clinicId, now, now, `MAT-${String(i).padStart(5, '0')}`, `模拟耗材${i + 1}`,
      '标准规格', pick(['CONSUMABLE', 'MATERIAL', 'MEDICINE']), '盒', stock, minStock, price,
      supplierIds[Math.floor(rand() * supplierIds.length)], rand() < 0.3 ? daysAgoIso(-30).slice(0, 10) : null, 'A区',
    );
    insertTx.run(randomUUID(), clinicId, now, now, id, stock, stock, adminId);
  }
})();

db.transaction(() => {
  const insertCard = db.prepare(
    `INSERT INTO MemberCard (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, cardNo, balance, totalRecharge, totalConsume, status, points, totalPoints, level
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < MEMBER_CARD_COUNT; i += 1) {
    const balance = Math.floor(rand() * 50000) * 100;
    insertCard.run(
      `sim-card-${i}`, clinicId, now, now, patientIds[Math.floor(rand() * patientIds.length)],
      `MC-${String(i).padStart(6, '0')}`, balance, balance, Math.floor(rand() * 20000) * 100,
      pick(['ACTIVE', 'ACTIVE', 'INACTIVE', 'FROZEN']), Math.floor(rand() * 1000), Math.floor(rand() * 1000),
      pick(['NORMAL', 'VIP', 'SVIP']),
    );
  }
})();

db.transaction(() => {
  const insertOrder = db.prepare(
    `INSERT INTO PurchaseOrder (
       id, clinicId, createdAt, updatedAt, deletedAt,
       number, supplierId, totalAmount, status, receivedAt, reviewStatus
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO PurchaseOrderItem (
       id, orderId, itemId, name, spec, quantity, unitPrice, subtotal,
       clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  for (let i = 0; i < PURCHASE_ORDER_COUNT; i += 1) {
    const id = `sim-po-${i}`;
    const supplierId = supplierIds[Math.floor(rand() * supplierIds.length)];
    const status = pick(['PENDING', 'APPROVED', 'RECEIVED']);
    const quantity = 1 + Math.floor(rand() * 20);
    const unitPrice = (100 + Math.floor(rand() * 5000)) * 100;
    const subtotal = quantity * unitPrice;
    insertOrder.run(
      id, clinicId, now, now, `SIM-PO-${String(i).padStart(6, '0')}`, supplierId, subtotal, status,
      status === 'RECEIVED' ? now : null, status === 'RECEIVED' ? 'APPROVED' : status === 'APPROVED' ? 'APPROVED' : 'PENDING',
    );
    insertItem.run(randomUUID(), id, inventoryIds[Math.floor(rand() * inventoryIds.length)], `采购项${i}`, '规格', quantity, unitPrice, subtotal, clinicId, now, now);
  }
})();

db.transaction(() => {
  const insertFollowUp = db.prepare(
    `INSERT INTO FollowUp (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, planDate, content, status, result, assigneeId, templateId, completedAt
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  for (let i = 0; i < FOLLOWUP_COUNT; i += 1) {
    const status = pick(FOLLOWUP_STATUSES);
    insertFollowUp.run(
      `sim-followup-${i}`, clinicId, now, now, patientIds[Math.floor(rand() * patientIds.length)],
      daysAgoIso(Math.floor(rand() * 60) - 30).slice(0, 10), '模拟回访', status,
      status === 'COMPLETED' ? '已联系' : null, doctorIds[Math.floor(rand() * doctorIds.length)],
      status === 'COMPLETED' ? now : null,
    );
  }
})();

if (process.env.V2_SIM_DIRTY === '1') {
  db.transaction(() => {
    const existingPhone = (db.prepare('SELECT phone FROM Patient WHERE phone IS NOT NULL LIMIT 1').get() as { phone: string }).phone;
    const insertDirtyPatient = db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, wechatId, preferredContact, contactNote,
         birthDate, idCard, address, occupation, remark, avatar,
         tags, allergies, medicalHistory, medicationHistory, systemicDiseases,
         source, active, isTempPatient
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', ?, NULL, 'PHONE', NULL,
         NULL, NULL, NULL, NULL, '脏数据备注', NULL,
         '[]', '[]', '[]', '[]', '[]', 'OTHER', 1, 0)`,
    );
    for (let i = 0; i < 30; i += 1) {
      insertDirtyPatient.run(
        `sim-dirty-patient-${i}`, clinicId, now, now, `P-DIRTY-${i}`, `脏数据患者${i}`, existingPhone,
      );
    }

    const base = db.prepare(
      `SELECT patientId, doctorId, startTime, endTime FROM Appointment LIMIT 1`,
    ).get() as { patientId: string; doctorId: string; startTime: string; endTime: string };
    const insertDirtyAppointment = db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR', '脏数据重叠预约')`,
    );
    for (let i = 0; i < 20; i += 1) {
      const start = new Date(new Date(base.startTime).getTime() + (15 + i) * 60_000);
      const end = new Date(start.getTime() + 45 * 60_000);
      insertDirtyAppointment.run(
        `sim-dirty-appt-${i}`, clinicId, now, now, base.patientId, base.doctorId,
        start.toISOString(), end.toISOString(),
      );
    }

    const insertDirtyFollowUp = db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status, result, assigneeId, templateId, completedAt
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, '历史逾期未处理', 'PENDING', NULL, ?, NULL, NULL)`,
    );
    for (let i = 0; i < 10; i += 1) {
      insertDirtyFollowUp.run(
        `sim-dirty-followup-${i}`, clinicId, now, now, patientIds[Math.floor(rand() * patientIds.length)],
        daysAgoIso(10 + i).slice(0, 10), doctorIds[Math.floor(rand() * doctorIds.length)],
      );
    }
  })();
}

rebuildSearchIndex(db);
const counts = {
  patients: (db.prepare('SELECT COUNT(*) AS c FROM Patient').get() as { c: number }).c,
  appointments: (db.prepare('SELECT COUNT(*) AS c FROM Appointment').get() as { c: number }).c,
  visits: (db.prepare('SELECT COUNT(*) AS c FROM Visit').get() as { c: number }).c,
  charges: (db.prepare('SELECT COUNT(*) AS c FROM Charge').get() as { c: number }).c,
  chargeItems: (db.prepare('SELECT COUNT(*) AS c FROM ChargeItem').get() as { c: number }).c,
  inventoryItems: (db.prepare('SELECT COUNT(*) AS c FROM InventoryItem').get() as { c: number }).c,
  memberCards: (db.prepare('SELECT COUNT(*) AS c FROM MemberCard').get() as { c: number }).c,
  purchaseOrders: (db.prepare('SELECT COUNT(*) AS c FROM PurchaseOrder').get() as { c: number }).c,
  followUps: (db.prepare('SELECT COUNT(*) AS c FROM FollowUp').get() as { c: number }).c,
};
const integrity = db.pragma('quick_check') as Array<{ quick_check: string }>;
db.close();

console.log('Simulated clinic data generated', {
  targetDir,
  counts,
  integrity: integrity[0]?.quick_check,
});
