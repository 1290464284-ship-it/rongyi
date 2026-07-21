import * as bcrypt from 'bcryptjs';
import { db, isTestMode } from './database';
import { scheduleAutoBackup } from './database';

export const seedDb = () => {
  // 测试模式下跳过 seed
  if (isTestMode()) return;
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM User').get() as { count: number }).count;
  if (userCount === 0) {
    // P3: 多诊所扩展 — 创建默认诊所
    const defaultClinicId = 'clinic-001';
    db.prepare(`INSERT INTO Clinic (id, name, code, address, phone, isActive) VALUES (?, ?, ?, ?, ?, 1)`)
      .run(defaultClinicId, '默认诊所', 'CLINIC-001', '', '');

    const isProd =
      process.env.NODE_ENV === 'production' || Boolean(process.env.ELECTRON_RUN_AS_NODE);
    const genRandomPin = () => String(Math.floor(1000 + Math.random() * 9000));
    const bossPassword = isProd ? genRandomPin() : 'REDACTED';
    const doctorPassword = isProd ? genRandomPin() : 'REDACTED';
    const frontPassword = isProd ? genRandomPin() : 'REDACTED';

    const bossHash = bcrypt.hashSync(bossPassword, 10);
    const doctorHash = bcrypt.hashSync(doctorPassword, 10);
    const frontHash = bcrypt.hashSync(frontPassword, 10);

    db.prepare(`INSERT INTO User (id, username, passwordHash, name, role, clinicId) VALUES
      ('boss-001', 'boss', ?, '老板', 'BOSS', ?),
      ('doctor-001', 'doctor', ?, '医生', 'DOCTOR', ?),
      ('front-001', 'front', ?, '前台', 'RECEPTIONIST', ?)`).run(bossHash, defaultClinicId, doctorHash, defaultClinicId, frontHash, defaultClinicId);

    console.log('\n=== 首次启动 ===');
    console.log('默认账号已创建，请尽快修改密码:');
    console.log('老板账号: boss');
    console.log('医生账号: doctor');
    console.log('前台账号: front');
    if (!isProd) {
      console.log(`(开发模式) 默认密码均为: ${bossPassword}\n`);
    } else {
      console.log('密码已随机生成，请妥善保管（可运行 reset-password 重置）。\n');
    }

    const treatments = [
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

    const insertTreatment = db.prepare(`INSERT INTO TreatmentCatalog (id, code, name, category, price) VALUES (?, ?, ?, ?, ?)`);
    treatments.forEach((t, i) => {
      insertTreatment.run(`tc-${i + 1}`, t.code, t.name, t.category, t.price);
    });

    const drugs = [
      { code: 'D001', name: '阿莫西林胶囊', spec: '0.5g*20粒', category: '抗生素', price: 25, unit: '盒' },
      { code: 'D002', name: '甲硝唑片', spec: '0.2g*24片', category: '抗生素', price: 15, unit: '盒' },
      { code: 'D003', name: '布洛芬缓释胶囊', spec: '0.3g*20粒', category: '止痛药', price: 20, unit: '盒' },
      { code: 'D004', name: '复方氯己定含漱液', spec: '200ml', category: '口腔护理', price: 18, unit: '瓶' },
      { code: 'D005', name: '维生素C片', spec: '100mg*100片', category: '维生素', price: 10, unit: '瓶' },
      { code: 'D006', name: '云南白药牙膏', spec: '120g', category: '口腔护理', price: 25, unit: '支' },
      { code: 'D007', name: '丁硼乳膏', spec: '65g', category: '口腔护理', price: 12, unit: '支' },
    ];

    const insertDrug = db.prepare(`INSERT INTO DrugCatalog (id, code, name, spec, category, price, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    drugs.forEach((d, i) => {
      insertDrug.run(`dc-${i + 1}`, d.code, d.name, d.spec, d.category, d.price, d.unit);
    });

    const chairs = [
      { name: '1号牙椅', location: '一楼A诊室' },
      { name: '2号牙椅', location: '一楼B诊室' },
      { name: '3号牙椅', location: '二楼C诊室' },
    ];
    const insertChair = db.prepare('INSERT INTO Chair (id, name, location) VALUES (?, ?, ?)');
    chairs.forEach((c, i) => {
      insertChair.run(`chair-${i + 1}`, c.name, c.location);
    });

    const clinicInfo = [
      { key: 'name', value: '口腔诊所' },
      { key: 'phone', value: '' },
      { key: 'address', value: '' },
      { key: 'logo', value: '' },
    ];
    const insertInfo = db.prepare('INSERT INTO ClinicInfo (id, key, value) VALUES (?, ?, ?)');
    clinicInfo.forEach((c, i) => {
      insertInfo.run(`info-${i + 1}`, c.key, c.value);
    });
  }

  scheduleAutoBackup();
};
