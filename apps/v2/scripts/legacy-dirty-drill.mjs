import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const sanitizedLegacy = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-legacy-dirty-'));
const dirtyLegacy = path.join(tempRoot, 'dirty-legacy.sqlite');
const dataDir = path.join(tempRoot, 'data');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
const port = 41000 + Math.floor(Math.random() * 1000);
const adminPassword = process.env.V2_ADMIN_PASSWORD ?? 'REDACTED';

fs.copyFileSync(sanitizedLegacy, dirtyLegacy);
const now = new Date().toISOString();
const dirty = new Database(dirtyLegacy);
try {
  dirty.pragma('foreign_keys = OFF');
  dirty.pragma('ignore_check_constraints = ON');
  dirty.prepare(
    `INSERT INTO Patient (
       id, code, name, gender, phone, source, clinicId, active, createdAt, updatedAt, deletedAt
     ) VALUES (?, 'DP1', '脏数据患者', 'UNKNOWN', '13800000000', 'WALK_IN', 'clinic-v2-001', 1, ?, ?, NULL)`,
  ).run('dirty-patient-1', now, now);
  dirty.prepare(
    `INSERT INTO MemberCard (
       id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints,
       level, status, clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, ?, 'CARD-DIRTY-1', -100, 0, 0, 0, 0, 'NORMAL', 'ACTIVE', 'clinic-v2-001', ?, ?, NULL)`,
  ).run('dirty-card-1', 'dirty-patient-1', now, now);
  dirty.prepare(
    `INSERT INTO Charge (
       id, patientId, number, totalAmount, paidAmount, refundedAmount, discount, status,
       clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, ?, 'DIRTY-CHG-1', 1000, 0, 0, 0, 'UNPAID', 'clinic-v2-001', ?, ?, NULL)`,
  ).run('dirty-charge-1', 'dirty-patient-1', now, now);
  dirty.prepare(
    `INSERT INTO Refund (
       id, chargeId, patientId, amount, reason, clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, 'missing-charge-999', 'dirty-patient-1', 0, '脏退款', 'clinic-v2-001', ?, ?, NULL)`,
  ).run('dirty-refund-1', now, now);
  dirty.prepare(
    `INSERT INTO ChargeItem (
       id, chargeId, name, category, price, quantity, teethNumbers, subtotal,
       clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, 'missing-charge-999', '脏明细', 'MATERIAL', 100, 0, '[]', 0, 'clinic-v2-001', ?, ?, NULL)`,
  ).run('dirty-charge-item-1', now, now);
  dirty.prepare(
    `INSERT INTO InventoryTransaction (
       id, itemId, type, quantity, unitPrice, totalAmount, clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, 'missing-item-999', 'OUT', -5, 100, -500, 'clinic-v2-001', ?, ?, NULL)`,
  ).run('dirty-inventory-tx-1', now, now);
  dirty.prepare(
    `INSERT INTO ProcessingOrder (
       id, number, patientId, factoryId, totalFee, status, creatorId, clinicId, createdAt, updatedAt, deletedAt
     ) VALUES (?, 'DIRTY-PO-1', 'missing-patient-999', 'dirty-factory-1', 1000, 'DRAFT', 'user-admin-001', 'clinic-v2-001', ?, ?, NULL)`,
  ).run('dirty-processing-1', now, now);
} finally {
  dirty.close();
}

let apiProcess = null;

function waitForApiOrExit(timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    apiProcess.once('exit', (code) => finish({ ok: false, code }));
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        finish({ ok: false, timeout: true });
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v2/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          finish({ ok: true });
          return;
        }
      } catch {
        // retry
      }
      setTimeout(() => void attempt(), 500);
    };
    void attempt();
  });
}

function startApi() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  apiProcess = spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: {
      ...process.env,
      V2_PORT: String(port),
      V2_HOST: '127.0.0.1',
      NODE_ENV: 'development',
      V2_DATA_DIR: dataDir,
      V2_BACKUP_DIR: backupDir,
      V2_LOG_DIR: logDir,
      V2_LEGACY_DB_PATH: dirtyLegacy,
      V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
      V2_JWT_SECRET: 'legacy-dirty-jwt-0123456789abcdef0123456789abcdef',
      V2_BACKUP_KEY: 'legacy-dirty-backup-key-0123456789abcdef',
      V2_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
}

function stopApi() {
  return new Promise((resolve) => {
    if (!apiProcess || apiProcess.killed || apiProcess.exitCode !== null) {
      resolve();
      return;
    }
    apiProcess.once('exit', resolve);
    apiProcess.kill();
    setTimeout(() => {
      if (apiProcess && !apiProcess.killed) apiProcess.kill('SIGKILL');
    }, 5000).unref();
  });
}

try {
  startApi();
  const result = await waitForApiOrExit();
  if (result.ok) {
    throw new Error('dirty legacy import unexpectedly succeeded; it should fail closed');
  }
  console.log('legacy dirty drill passed: dirty legacy import fails closed before startup', {
    code: result.code ?? null,
    timeout: result.timeout ?? false,
  });
} finally {
  await stopApi();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
