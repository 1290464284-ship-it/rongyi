#!/usr/bin/env node
/**
 * 核心性能基准测试脚本
 *
 * 测试场景：
 * 1. 收费创建吞吐量（1000次/并发）
 * 2. 患者查询响应时间（分页100条）
 * 3. 库存并发扣减（100并发）
 * 4. 统计查询缓存命中率
 *
 * 输出：QPS、P50/P95/P99延迟、错误率
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'benchmark-temp.sqlite');
const CLINIC_ID = 'benchmark-clinic-001';

// ==================== 工具函数 ====================

function formatNumber(num, digits = 2) {
  return Number(num).toFixed(digits);
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function calcLatencyStats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    avg: total / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function printReport(results) {
  console.log('\n' + '='.repeat(90));
  console.log('  口腔诊所管理系统 — 核心性能基准测试报告');
  console.log('='.repeat(90));
  console.log(`  时间: ${new Date().toISOString()}`);
  console.log(`  Node.js: ${process.version}`);
  console.log(`  平台: ${os.platform()} ${os.arch()}`);
  console.log(`  CPU: ${os.cpus()[0]?.model || 'unknown'} (${os.cpus().length} 核)`);
  console.log(`  内存: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log('='.repeat(90));

  for (const r of results) {
    console.log(`\n  [${r.name}]`);
    console.log(`    总请求数: ${r.totalRequests}  |  错误数: ${r.errors}  |  错误率: ${(r.errorRate * 100).toFixed(2)}%`);
    console.log(`    总耗时: ${formatNumber(r.totalMs)} ms  |  QPS: ${formatNumber(r.qps)}`);
    console.log(`    P50: ${formatNumber(r.p50)} ms  |  P95: ${formatNumber(r.p95)} ms  |  P99: ${formatNumber(r.p99)} ms`);
    console.log(`    AVG: ${formatNumber(r.avg)} ms  |  MIN: ${formatNumber(r.min)} ms  |  MAX: ${formatNumber(r.max)} ms`);
    if (r.cacheHitRate !== undefined) {
      console.log(`    缓存命中率: ${(r.cacheHitRate * 100).toFixed(2)}%`);
    }
    if (r.note) {
      console.log(`    备注: ${r.note}`);
    }
  }

  console.log('\n' + '='.repeat(90));
}

// ==================== 数据库初始化 ====================

function setupDb() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  for (const ext of ['-wal', '-shm']) {
    const f = DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -50000');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');

  // 创建简化版业务表
  db.exec(`
    CREATE TABLE Charge (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT,
      number TEXT NOT NULL,
      totalAmount INTEGER DEFAULT 0,
      paidAmount INTEGER DEFAULT 0,
      refundedAmount INTEGER DEFAULT 0,
      discount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'UNPAID',
      paidAt TEXT,
      remark TEXT,
      clinicId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );
    CREATE INDEX idx_charge_clinic ON Charge(clinicId);
    CREATE INDEX idx_charge_clinic_deleted_created ON Charge(clinicId, deletedAt, createdAt);

    CREATE TABLE ChargeItem (
      id TEXT PRIMARY KEY,
      chargeId TEXT NOT NULL,
      treatmentId TEXT,
      inventoryItemId TEXT,
      name TEXT NOT NULL,
      category TEXT,
      price INTEGER DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      teethNumbers TEXT,
      subtotal INTEGER DEFAULT 0,
      clinicId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX idx_chargeitem_charge ON ChargeItem(chargeId);

    CREATE TABLE Patient (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      birthDate TEXT,
      phone TEXT NOT NULL,
      idCard TEXT,
      address TEXT,
      occupation TEXT,
      remark TEXT,
      source TEXT DEFAULT 'WALK_IN',
      tags TEXT DEFAULT '[]',
      allergies TEXT DEFAULT '[]',
      medicalHistory TEXT DEFAULT '[]',
      medicationHistory TEXT DEFAULT '[]',
      systemicDiseases TEXT DEFAULT '[]',
      referrer TEXT,
      emergencyContact TEXT,
      emergencyPhone TEXT,
      familyId TEXT,
      active INTEGER DEFAULT 1,
      clinicId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );
    CREATE INDEX idx_patient_clinic ON Patient(clinicId);
    CREATE INDEX idx_patient_clinic_deleted_created ON Patient(clinicId, deletedAt, createdAt);
    CREATE INDEX idx_patient_name ON Patient(name);
    CREATE INDEX idx_patient_phone ON Patient(phone);

    CREATE TABLE InventoryItem (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      spec TEXT,
      category TEXT,
      unit TEXT,
      stock REAL DEFAULT 0,
      minStock REAL DEFAULT 0,
      price REAL DEFAULT 0,
      supplierId TEXT,
      expireDate TEXT,
      location TEXT,
      remark TEXT,
      clinicId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );
    CREATE INDEX idx_inventory_clinic ON InventoryItem(clinicId);
  `);

  return db;
}

function seedData(db) {
  console.log('  正在插入测试数据...');

  const patients = [];
  for (let i = 0; i < 5000; i++) {
    patients.push([
      `pat-${i}`,
      `P${String(i).padStart(6, '0')}`,
      `患者${i}`,
      i % 2 === 0 ? 'MALE' : 'FEMALE',
      '1990-01-01',
      `138${String(i).padStart(8, '0').slice(-8)}`,
      null, null, null, null,
      'WALK_IN',
      '[]', '[]', '[]', '[]', '[]',
      null, null, null, null,
      1,
      CLINIC_ID,
      new Date(Date.now() - i * 3600000).toISOString(),
      new Date(Date.now() - i * 3600000).toISOString(),
      null,
    ]);
  }

  const insertPatient = db.prepare(`
    INSERT INTO Patient VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertManyPatients = db.transaction((rows) => {
    for (const row of rows) insertPatient.run(...row);
  });
  insertManyPatients(patients);

  const charges = [];
  for (let i = 0; i < 10000; i++) {
    const isPaid = i % 3 === 0;
    const ts = new Date(Date.now() - i * 1800000).toISOString();
    charges.push([
      `charge-${i}`,
      `pat-${i % 5000}`,
      null,
      `doctor-${i % 10}`,
      `C${String(i).padStart(8, '0')}`,
      10000 + (i % 100) * 100,
      isPaid ? 10000 + (i % 100) * 100 : 0,
      0, 0,
      isPaid ? 'PAID' : 'UNPAID',
      isPaid ? ts : null,
      null,
      CLINIC_ID,
      ts,
      ts,
      null,
    ]);
  }
  const insertCharge = db.prepare(`
    INSERT INTO Charge VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertManyCharges = db.transaction((rows) => {
    for (const row of rows) insertCharge.run(...row);
  });
  insertManyCharges(charges);

  const insertItem = db.prepare(`
    INSERT INTO InventoryItem (id, code, name, spec, category, unit, stock, minStock, price, clinicId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertItem.run('inv-1', 'INV-001', '测试材料', '规格A', '材料', '个', 100000, 10, 500, CLINIC_ID, new Date().toISOString(), new Date().toISOString());

  console.log('  测试数据插入完成: 5000 患者, 10000 收费单, 1 库存项');
}

// ==================== Worker 并发测试 ====================

function runWorkers(dbPath, sql, paramsFn, workerCount, iterationsPerWorker) {
  return new Promise((resolve, reject) => {
    const results = [];
    let exited = 0;

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: {
          mode: 'worker',
          dbPath,
          workerId: i,
          iterations: iterationsPerWorker,
          sql,
          params: paramsFn(i),
        },
      });

      worker.on('message', (msg) => results.push(msg));
      worker.on('error', reject);
      worker.on('exit', () => {
        exited++;
        if (exited === workerCount) resolve(results);
      });
    }
  });
}

if (!isMainThread && workerData?.mode === 'worker') {
  const { dbPath, sql, params, iterations } = workerData;
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  const stmt = db.prepare(sql);
  const times = [];
  let errors = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const r = stmt.run(...params);
      if (r.changes === 0) errors++;
    } catch {
      errors++;
    }
    const end = performance.now();
    times.push(end - start);
  }

  db.close();
  parentPort.postMessage({ times, errors });
}

// ==================== 主测试流程 ====================

async function main() {
  console.log('\n' + '='.repeat(90));
  console.log('  开始核心性能基准测试');
  console.log('='.repeat(90));

  const db = setupDb();
  seedData(db);
  db.close();

  const results = [];

  // ---- 场景1: 收费创建吞吐量（1000次） ----
  {
    console.log('\n  [场景1] 收费创建吞吐量测试 (1000次)...');
    const db1 = new Database(DB_PATH);
    db1.pragma('busy_timeout = 5000');
    const insertCharge = db1.prepare(`
      INSERT INTO Charge (id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, clinicId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)
    `);
    const insertItem = db1.prepare(`
      INSERT INTO ChargeItem (id, chargeId, treatmentId, inventoryItemId, name, category, price, quantity, teethNumbers, subtotal, clinicId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const times = [];
    let errors = 0;
    const count = 1000;
    const startAll = performance.now();

    for (let i = 0; i < count; i++) {
      const id = `bench-charge-${i}`;
      const now = new Date().toISOString();
      const s = performance.now();
      try {
        db1.transaction(() => {
          insertCharge.run(id, 'pat-1', null, 'doctor-1', `BN${i}`, 5000, 'UNPAID', null, CLINIC_ID, now, now);
          insertItem.run(`bench-ci-${i}`, id, null, null, '治疗项目', '通用', 5000, 1, '[]', 5000, CLINIC_ID, now);
        })();
      } catch {
        errors++;
      }
      const e = performance.now();
      times.push(e - s);
    }

    const totalMs = performance.now() - startAll;
    const lat = calcLatencyStats(times);
    results.push({
      name: '收费创建吞吐量',
      totalRequests: count,
      errors,
      errorRate: errors / count,
      totalMs,
      qps: count / (totalMs / 1000),
      ...lat,
    });
    db1.close();
  }

  // ---- 场景2: 患者查询响应时间（分页100条） ----
  {
    console.log('  [场景2] 患者查询响应时间测试 (分页100条, 1000次)...');
    const db2 = new Database(DB_PATH);
    db2.pragma('busy_timeout = 5000');
    const stmt = db2.prepare(`
      SELECT id, code, name, gender, birthDate, phone, idCard, source, tags, active, createdAt, updatedAt
      FROM Patient
      WHERE clinicId = ? AND deletedAt IS NULL
      ORDER BY createdAt DESC, id DESC
      LIMIT ? OFFSET ?
    `);

    const times = [];
    const count = 1000;
    const startAll = performance.now();

    for (let i = 0; i < count; i++) {
      const s = performance.now();
      stmt.all(CLINIC_ID, 100, (i % 50) * 100);
      const e = performance.now();
      times.push(e - s);
    }

    const totalMs = performance.now() - startAll;
    const lat = calcLatencyStats(times);
    results.push({
      name: '患者查询(分页100条)',
      totalRequests: count,
      errors: 0,
      errorRate: 0,
      totalMs,
      qps: count / (totalMs / 1000),
      ...lat,
    });
    db2.close();
  }

  // ---- 场景3: 库存并发扣减（100并发 * 10次 = 1000次） ----
  {
    console.log('  [场景3] 库存并发扣减测试 (100并发 * 10次)...');
    // 重置库存
    const db3 = new Database(DB_PATH);
    db3.prepare("UPDATE InventoryItem SET stock = 10000 WHERE id = 'inv-1'").run();
    db3.close();

    const workerResults = await runWorkers(
      DB_PATH,
      "UPDATE InventoryItem SET stock = stock - ? WHERE id = 'inv-1' AND clinicId = ? AND stock >= ?",
      () => [1, CLINIC_ID, 1],
      100,
      10,
    );

    const allTimes = workerResults.flatMap(r => r.times);
    const totalErrors = workerResults.reduce((s, r) => s + r.errors, 0);
    const totalMs = allTimes.reduce((a, b) => a + b, 0);
    const lat = calcLatencyStats(allTimes);

    results.push({
      name: '库存并发扣减(100并发)',
      totalRequests: 1000,
      errors: totalErrors,
      errorRate: totalErrors / 1000,
      totalMs,
      qps: 1000 / (totalMs / 1000),
      ...lat,
      note: '100个Worker线程各执行10次扣减',
    });
  }

  // ---- 场景4: 统计查询缓存命中率 ----
  {
    console.log('  [场景4] 统计查询缓存命中率测试 (先预热再测量)...');
    const db4 = new Database(DB_PATH);
    db4.pragma('busy_timeout = 5000');

    // 获取预热前缓存状态
    const cacheHitBefore = db4.pragma('cache_hit');
    const cacheMissBefore = db4.pragma('cache_miss');
    const hitBefore = cacheHitBefore?.[0]?.cache_hit ?? 0;
    const missBefore = cacheMissBefore?.[0]?.cache_miss ?? 0;

    const stmt = db4.prepare(`
      SELECT date(paidAt) as date, COUNT(*) as count, COALESCE(SUM(paidAmount), 0) as amount
      FROM Charge
      WHERE deletedAt IS NULL AND paidAt IS NOT NULL AND clinicId = ?
      GROUP BY date
      ORDER BY date
    `);

    // Warm up: 执行 50 次让 SQLite page cache 预热
    for (let i = 0; i < 50; i++) stmt.all(CLINIC_ID);

    const cacheHitWarm = db4.pragma('cache_hit');
    const cacheMissWarm = db4.pragma('cache_miss');
    const hitWarm = cacheHitWarm?.[0]?.cache_hit ?? 0;
    const missWarm = cacheMissWarm?.[0]?.cache_miss ?? 0;

    // 正式测试 1000 次
    const times = [];
    const count = 1000;
    const startAll = performance.now();
    for (let i = 0; i < count; i++) {
      const s = performance.now();
      stmt.all(CLINIC_ID);
      const e = performance.now();
      times.push(e - s);
    }
    const totalMs = performance.now() - startAll;

    const cacheHitAfter = db4.pragma('cache_hit');
    const cacheMissAfter = db4.pragma('cache_miss');
    const hitAfter = cacheHitAfter?.[0]?.cache_hit ?? 0;
    const missAfter = cacheMissAfter?.[0]?.cache_miss ?? 0;

    const testHits = hitAfter - hitWarm;
    const testMisses = missAfter - missWarm;
    const totalCacheAccess = testHits + testMisses;
    const cacheHitRate = totalCacheAccess > 0 ? testHits / totalCacheAccess : 0;

    const lat = calcLatencyStats(times);
    results.push({
      name: '统计查询(缓存预热后)',
      totalRequests: count,
      errors: 0,
      errorRate: 0,
      totalMs,
      qps: count / (totalMs / 1000),
      ...lat,
      cacheHitRate,
      note: `SQLite page cache 命中=${testHits}, 未命中=${testMisses}`,
    });
    db4.close();
  }

  // 清理
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  for (const ext of ['-wal', '-shm']) {
    const f = DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  printReport(results);
}

if (isMainThread) {
  main().catch((err) => {
    console.error('基准测试失败:', err);
    process.exit(1);
  });
}
