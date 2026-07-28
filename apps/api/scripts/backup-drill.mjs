#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createTestSchema(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Clinic (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS Patient (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gender TEXT,
      phone TEXT,
      clinicId TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS Charge (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      number TEXT UNIQUE NOT NULL,
      totalAmount INTEGER NOT NULL,
      paidAmount INTEGER DEFAULT 0,
      refundedAmount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'UNPAID',
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ChargeItem (
      id TEXT PRIMARY KEY,
      chargeId TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      subtotal INTEGER DEFAULT 0,
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS MemberCard (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      cardNo TEXT UNIQUE NOT NULL,
      balance INTEGER DEFAULT 0,
      totalRecharge INTEGER DEFAULT 0,
      totalConsume INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS InventoryItem (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      stock REAL DEFAULT 0,
      minStock REAL DEFAULT 0,
      price INTEGER DEFAULT 0,
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_charge_patient ON Charge(patientId);
    CREATE INDEX IF NOT EXISTS idx_charge_status ON Charge(status);
    CREATE INDEX IF NOT EXISTS idx_charge_item_order ON ChargeItem(chargeId);
    CREATE INDEX IF NOT EXISTS idx_member_card_patient ON MemberCard(patientId);
    CREATE INDEX IF NOT EXISTS idx_inventory_item_code ON InventoryItem(code);
    CREATE INDEX IF NOT EXISTS idx_patient_clinic ON Patient(clinicId);
  `);
}

function seedTestData(db) {
  const now = new Date().toISOString();
  const clinicId = 'drill-clinic-' + crypto.randomUUID().slice(0, 8);
  const patientId = 'drill-patient-' + crypto.randomUUID().slice(0, 8);
  const cardId = 'drill-card-' + crypto.randomUUID().slice(0, 8);

  db.prepare(
    'INSERT INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  ).run(clinicId, '演练诊所', 'DRILL-' + crypto.randomUUID().slice(0, 6).toUpperCase(), now, now);

  const insertPatient = db.prepare(
    'INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
  );
  for (let i = 0; i < 10; i++) {
    insertPatient.run(
      patientId + '-' + i,
      'P' + String(i).padStart(4, '0'),
      '演练患者-' + i,
      i % 2 === 0 ? 'MALE' : 'FEMALE',
      '138' + String(10000000 + i).padStart(8, '0'),
      clinicId,
      now,
      now,
    );
  }

  const insertCharge = db.prepare(
    'INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, refundedAmount, status, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
  );
  const insertChargeItem = db.prepare(
    'INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  const statuses = ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED'];
  for (let i = 0; i < 20; i++) {
    const chargeId = 'drill-charge-' + i;
    const patientRef = patientId + '-' + (i % 10);
    const total = (i + 1) * 10000;
    const status = statuses[i % statuses.length];
    const paid = status === 'PAID' || status === 'REFUNDED' ? total : status === 'PARTIAL' ? Math.floor(total / 2) : 0;
    const refunded = status === 'REFUNDED' ? total : 0;

    insertCharge.run(
      chargeId,
      patientRef,
      'C' + formatTimestamp(new Date()) + String(i).padStart(4, '0'),
      total,
      paid,
      status,
      clinicId,
      now,
      now,
    );

    const itemCount = (i % 3) + 1;
    for (let j = 0; j < itemCount; j++) {
      const price = (j + 1) * 5000;
      const qty = (j % 2) + 1;
      insertChargeItem.run(
        chargeId + '-item-' + j,
        chargeId,
        '治疗项目-' + j,
        '类别-' + (j % 5),
        price,
        qty,
        price * qty,
        clinicId,
        now,
      );
    }
  }

  db.prepare(
    "INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, points, status, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 500, 'ACTIVE', ?, ?, ?)",
  ).run(cardId, patientId + '-0', 'MC-DRILL-001', 500000, 800000, 300000, clinicId, now, now);

  const insertInventory = db.prepare(
    'INSERT INTO InventoryItem (id, code, name, category, stock, minStock, price, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const categories = ['药品', '耗材', '材料', '器械'];
  for (let i = 0; i < 15; i++) {
    insertInventory.run(
      'drill-inv-' + i,
      'INV' + String(i).padStart(6, '0'),
      '库存物品-' + i,
      categories[i % categories.length],
      Math.floor(Math.random() * 200) + 10,
      10,
      (i + 1) * 1000,
      clinicId,
      now,
      now,
    );
  }

  return { clinicId, patientId, cardId, chargeCount: 20, chargeItemCount: db.prepare('SELECT COUNT(*) as cnt FROM ChargeItem').get().cnt };
}

function captureState(db) {
  const tables = ['Clinic', 'Patient', 'Charge', 'ChargeItem', 'MemberCard', 'InventoryItem'];
  const counts = {};
  const rowCounts = {};

  for (const table of tables) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get().cnt;
    } catch {
      counts[table] = -1;
    }
  }

  rowCounts.ChargeItem = db.prepare('SELECT COUNT(*) as cnt FROM ChargeItem').get().cnt;

  const chargeSummary = db.prepare(`
    SELECT
      COUNT(*) as totalCharges,
      SUM(totalAmount) as totalAmount,
      SUM(paidAmount) as totalPaid,
      SUM(refundedAmount) as totalRefunded
    FROM Charge
  `).get();

  const patientSummary = db.prepare(`
    SELECT
      COUNT(*) as totalPatients
    FROM Patient
  `).get();

  const cardSummary = db.prepare(`
    SELECT
      SUM(balance) as totalBalance,
      SUM(points) as totalPoints
    FROM MemberCard
  `).get();

  const invSummary = db.prepare(`
    SELECT
      SUM(stock) as totalStock,
      COUNT(*) as totalItems
    FROM InventoryItem
  `).get();

  return {
    counts,
    rowCounts,
    chargeSummary,
    patientSummary,
    cardSummary,
    invSummary,
  };
}

function verifyIntegrity(db) {
  const result = db.prepare('PRAGMA integrity_check').all();
  return result.every((row) => row.integrity_check === 'ok');
}

function dataConsistencyCheck(db, state) {
  const checks = [];

  const current = captureState(db);

  for (const table of Object.keys(state.counts)) {
    if (current.counts[table] !== state.counts[table]) {
      checks.push({
        check: `表 ${table} 记录数不一致`,
        expected: state.counts[table],
        actual: current.counts[table],
        passed: false,
      });
    } else {
      checks.push({
        check: `表 ${table} 记录数一致`,
        expected: state.counts[table],
        actual: current.counts[table],
        passed: true,
      });
    }
  }

  if (current.chargeSummary.totalAmount !== state.chargeSummary.totalAmount) {
    checks.push({
      check: 'Charge 总金额不一致',
      expected: state.chargeSummary.totalAmount,
      actual: current.chargeSummary.totalAmount,
      passed: false,
    });
  } else {
    checks.push({
      check: 'Charge 总金额一致',
      expected: state.chargeSummary.totalAmount,
      actual: current.chargeSummary.totalAmount,
      passed: true,
    });
  }

  if (current.chargeSummary.totalPaid !== state.chargeSummary.totalPaid) {
    checks.push({
      check: 'Charge 已付金额不一致',
      expected: state.chargeSummary.totalPaid,
      actual: current.chargeSummary.totalPaid,
      passed: false,
    });
  }

  if (current.patientSummary.totalPatients !== state.patientSummary.totalPatients) {
    checks.push({
      check: 'Patient 记录数不一致',
      expected: state.patientSummary.totalPatients,
      actual: current.patientSummary.totalPatients,
      passed: false,
    });
  }

  if (current.cardSummary?.totalBalance !== state.cardSummary?.totalBalance) {
    checks.push({
      check: 'MemberCard 余额不一致',
      expected: state.cardSummary?.totalBalance,
      actual: current.cardSummary?.totalBalance,
      passed: false,
    });
  }

  if (current.invSummary?.totalStock !== state.invSummary?.totalStock) {
    checks.push({
      check: 'InventoryItem 总库存不一致',
      expected: state.invSummary?.totalStock,
      actual: current.invSummary?.totalStock,
      passed: false,
    });
  }

  const allPassed = checks.every((c) => c.passed);
  return { allPassed, checks };
}

async function runDrill() {
  const report = {
    startedAt: new Date().toISOString(),
    steps: [],
    success: false,
    overallDurationMs: 0,
  };

  const drillStart = Date.now();

  const tempDir = path.join(os.tmpdir(), 'backup-drill-' + Date.now());
  const dbPath = path.join(tempDir, 'drill-test.db');
  const backupPath = path.join(tempDir, 'drill-backup.db');

  console.log('='.repeat(60));
  console.log('备份恢复演练 (Backup & Restore Drill)');
  console.log('='.repeat(60));
  console.log(`临时目录: ${tempDir}`);
  console.log('');

  try {
    ensureDir(tempDir);

    console.log('[步骤 1] 创建测试数据库...');
    const step1Start = Date.now();
    const srcDb = new Database(dbPath);
    createTestSchema(srcDb);
    const seedInfo = seedTestData(srcDb);
    const originalState = captureState(srcDb);
    const integrityBefore = verifyIntegrity(srcDb);
    const step1Duration = Date.now() - step1Start;

    report.steps.push({
      step: '创建测试数据库',
      status: 'success',
      durationMs: step1Duration,
      details: {
        ...seedInfo,
        integrity: integrityBefore,
        state: originalState,
      },
    });

    console.log(`  ✓ 测试数据库创建完成 (耗时 ${step1Duration}ms)`);
    console.log(`    - 患者: ${seedInfo.chargeCount} 条, 收费项: ${seedInfo.chargeItemCount} 条`);
    console.log(`    - 完整性检查: ${integrityBefore ? '通过' : '失败'}`);

    console.log('');
    console.log('[步骤 2] 创建数据库备份...');
    const step2Start = Date.now();

    srcDb.pragma('wal_checkpoint(FULL)');
    await srcDb.backup(backupPath);

    const backupSize = fs.statSync(backupPath).size;
    const verifyBackupDb = new Database(backupPath, { readonly: true });
    const backupIntegrity = verifyIntegrity(verifyBackupDb);
    const backupState = captureState(verifyBackupDb);
    verifyBackupDb.close();

    const step2Duration = Date.now() - step2Start;

    const backupConsistent = JSON.stringify(originalState) === JSON.stringify(backupState);

    report.steps.push({
      step: '创建数据库备份',
      status: backupIntegrity && backupConsistent ? 'success' : 'warning',
      durationMs: step2Duration,
      details: {
        backupSize,
        integrity: backupIntegrity,
        dataConsistent: backupConsistent,
      },
    });

    console.log(`  ✓ 备份创建完成 (耗时 ${step2Duration}ms)`);
    console.log(`    - 备份大小: ${formatSize(backupSize)}`);
    console.log(`    - 完整性: ${backupIntegrity ? '通过' : '失败'}`);
    console.log(`    - 数据一致性: ${backupConsistent ? '一致' : '不一致'}`);

    srcDb.close();

    console.log('');
    console.log('[步骤 3] 删除测试数据...');
    const step3Start = Date.now();

    const tempDbPath2 = path.join(tempDir, 'drill-deleted.db');
    fs.copyFileSync(dbPath, tempDbPath2);
    const delDb = new Database(tempDbPath2);

    delDb.exec('DELETE FROM ChargeItem');
    delDb.exec('DELETE FROM Charge');
    delDb.exec('DELETE FROM MemberCard');
    delDb.exec('DELETE FROM InventoryItem');
    delDb.exec('DELETE FROM Patient');
    delDb.exec('DELETE FROM Clinic');

    const afterDeleteCount = delDb.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().cnt;

    const remainingTables = delDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);

    const step3Duration = Date.now() - step3Start;

    report.steps.push({
      step: '删除测试数据',
      status: remainingTables.length === 0 || remainingTables.length <= 10 ? 'success' : 'warning',
      durationMs: step3Duration,
      details: {
        remainingTables,
        tableCount: remainingTables.length,
      },
    });

    console.log(`  ✓ 数据删除完成 (耗时 ${step3Duration}ms)`);
    console.log(`    - 剩余表: ${remainingTables.length} 个`);

    delDb.close();
    fs.unlinkSync(tempDbPath2);

    console.log('');
    console.log('[步骤 4] 从备份恢复...');
    const step4Start = Date.now();

    fs.copyFileSync(backupPath, dbPath);

    const restoredDb = new Database(dbPath, { readonly: true });
    const restoreIntegrity = verifyIntegrity(restoredDb);
    const restoredState = captureState(restoredDb);

    const step4Duration = Date.now() - step4Start;

    report.steps.push({
      step: '从备份恢复',
      status: restoreIntegrity ? 'success' : 'failure',
      durationMs: step4Duration,
      details: {
        integrity: restoreIntegrity,
      },
    });

    console.log(`  ✓ 恢复完成 (耗时 ${step4Duration}ms)`);
    console.log(`    - 完整性: ${restoreIntegrity ? '通过' : '失败'}`);

    restoredDb.close();

    console.log('');
    console.log('[步骤 5] 验证恢复数据完整性...');
    const step5Start = Date.now();

    const verifyDb = new Database(dbPath, { readonly: true });
    const consistency = dataConsistencyCheck(verifyDb, originalState);
    const integrityAfterRestore = verifyIntegrity(verifyDb);

    const step5Duration = Date.now() - step5Start;

    const reportStep5 = {
      step: '验证恢复数据完整性',
      status: consistency.allPassed && integrityAfterRestore ? 'success' : 'failure',
      durationMs: step5Duration,
      details: {
        integrity: integrityAfterRestore,
        allChecksPassed: consistency.allPassed,
        checks: consistency.checks,
      },
    };
    report.steps.push(reportStep5);

    console.log(`  ${consistency.allPassed ? '✓' : '✗'} 数据完整性验证 (耗时 ${step5Duration}ms)`);
    console.log(`    - 完整性: ${integrityAfterRestore ? '通过' : '失败'}`);
    console.log(`    - 一致性检查: ${consistency.checks.length} 项`);
    for (const check of consistency.checks) {
      console.log(`      ${check.passed ? '✓' : '✗'} ${check.check} (期望: ${check.expected}, 实际: ${check.actual})`);
    }

    verifyDb.close();

    report.success = consistency.allPassed && integrityAfterRestore;
  } catch (err) {
    console.error('演练过程中发生错误:', err.message);
    report.error = err.message;
    report.success = false;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('');
      console.log(`临时目录已清理: ${tempDir}`);
    } catch {
      console.log(`临时目录清理失败，请手动删除: ${tempDir}`);
    }
  }

  report.overallDurationMs = Date.now() - drillStart;
  report.endedAt = new Date().toISOString();

  console.log('');
  console.log('='.repeat(60));
  console.log('演练报告');
  console.log('='.repeat(60));
  console.log(`结果: ${report.success ? '成功 ✓' : '失败 ✗'}`);
  console.log(`开始时间: ${report.startedAt}`);
  console.log(`结束时间: ${report.endedAt}`);
  console.log(`总耗时: ${(report.overallDurationMs / 1000).toFixed(2)} 秒`);
  console.log('');

  const stepSuccessCount = report.steps.filter((s) => s.status === 'success').length;
  const stepWarningCount = report.steps.filter((s) => s.status === 'warning').length;
  const stepFailureCount = report.steps.filter((s) => s.status === 'failure').length;
  const totalSteps = report.steps.length;

  console.log(`步骤统计:`);
  console.log(`  成功: ${stepSuccessCount}/${totalSteps}`);
  console.log(`  警告: ${stepWarningCount}/${totalSteps}`);
  console.log(`  失败: ${stepFailureCount}/${totalSteps}`);
  console.log(`  成功率: ${((stepSuccessCount / totalSteps) * 100).toFixed(1)}%`);
  console.log('');

  console.log('各步骤详情:');
  for (const step of report.steps) {
    const statusIcon = step.status === 'success' ? '✓' : step.status === 'warning' ? '⚠' : '✗';
    console.log(`  ${statusIcon} ${step.step} - ${step.durationMs}ms`);
    if (step.details?.dataConsistent !== undefined) {
      console.log(`     数据一致性: ${step.details.dataConsistent ? '一致' : '不一致'}`);
    }
    if (step.details?.checks) {
      const passedChecks = step.details.checks.filter((c) => c.passed).length;
      console.log(`     一致性检查: ${passedChecks}/${step.details.checks.length} 通过`);
    }
  }

  if (report.error) {
    console.log('');
    console.log(`错误信息: ${report.error}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`演练${report.success ? '成功完成' : '未通过'}！`);
  console.log('='.repeat(60));

  return report;
}

runDrill().then((report) => {
  process.exit(report.success ? 0 : 1);
}).catch((err) => {
  console.error('演练脚本异常:', err);
  process.exit(1);
});