import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createDatabase, createPerformanceIndexes, seedDatabase } from '../src/server/infrastructure/database';
import { runMigrations } from '../src/server/infrastructure/migrations';
import { StatsService } from '../src/server/application/read-services';
import { ReplenishmentService } from '../src/server/application/service-modules/replenishment';
import type { AppContext } from '../src/domain/contracts';

const THRESHOLDS = {
  dashboardColdMs: 10_000,
  dashboardHotMs: 2_000,
  replenishmentColdMs: 30_000,
  replenishmentHotMs: 5_000,
} as const;

const failures: string[] = [];
const metrics: Record<string, number> = {};

function report(label: string, elapsedMs: number, limitMs: number): void {
  metrics[label] = elapsedMs;
  const ok = elapsedMs <= limitMs;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${Math.round(elapsedMs)}ms (limit ${limitMs}ms)`);
  if (!ok) failures.push(`${label}: ${Math.round(elapsedMs)}ms > ${limitMs}ms`);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-benchmark-snapshots-'));
const db = createDatabase(dataDir);
seedDatabase(db);
runMigrations(db);
createPerformanceIndexes(db);

const context: AppContext = {
  userId: 'user-admin-001',
  clinicId: 'clinic-v2-001',
  role: 'BOSS',
  traceId: 'benchmark-snapshots',
  now: () => new Date('2026-08-13T00:00:00.000Z'),
};
const now = '2026-08-13T00:00:00.000Z';

const insertPatient = db.prepare(
  `INSERT INTO Patient (
     id, clinicId, createdAt, updatedAt, deletedAt,
     code, name, gender, phone, tags, allergies, medicalHistory,
     medicationHistory, systemicDiseases, source, active
   ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', ?, '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
);
const insertCharge = db.prepare(
  `INSERT INTO Charge (
     id, clinicId, createdAt, updatedAt, deletedAt,
     patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
   ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1000, 1000, 0, 0, 'PAID')`,
);
const insertTransaction = db.prepare(
  `INSERT INTO InventoryTransaction (
     id, clinicId, createdAt, updatedAt, deletedAt,
     itemId, type, quantity, beforeStock, afterStock, operatorId, remark,
     referenceType, referenceId, batchId
   ) VALUES (?, ?, ?, ?, NULL, ?, 'IN', 1, 0, 1, 'user-admin-001', NULL, NULL, NULL, NULL)`,
);
const insertItem = db.prepare(
  `INSERT INTO InventoryItem (id, clinicId, createdAt, updatedAt, deletedAt, code, name, stock, minStock)
   VALUES (?, ?, ?, ?, NULL, ?, ?, 10, 1)`,
);

db.transaction(() => {
  for (let i = 0; i < 50_000; i += 1) {
    insertPatient.run(`snap-patient-${i}`, context.clinicId, now, now, `SNAP-${i}`, `Patient ${i}`, `136${String(i).padStart(8, '0')}`);
    insertCharge.run(`snap-charge-${i}`, context.clinicId, now, now, `snap-patient-${i}`, `SNAP-CHG-${i}`);
    insertItem.run(`snap-item-${i}`, context.clinicId, now, now, `SNAP-ITEM-${i}`, `Item ${i}`);
    insertTransaction.run(`snap-txn-${i}`, context.clinicId, now, now, `snap-item-${i}`);
  }
})();

db.prepare('DELETE FROM StatSnapshot').run();
let stats = new StatsService(db);
let started = performance.now();
stats.dashboard(context);
report('dashboard cold (materialized snapshot)', performance.now() - started, THRESHOLDS.dashboardColdMs);

stats = new StatsService(db);
started = performance.now();
stats.dashboard(context);
report('dashboard hot (snapshot read)', performance.now() - started, THRESHOLDS.dashboardHotMs);

db.prepare('DELETE FROM ReplenishmentSnapshot').run();
let replenishment = new ReplenishmentService(db);
started = performance.now();
replenishment.generate(context);
report('replenishment cold (materialized snapshot)', performance.now() - started, THRESHOLDS.replenishmentColdMs);

replenishment = new ReplenishmentService(db);
started = performance.now();
replenishment.generate(context);
report('replenishment hot (snapshot read)', performance.now() - started, THRESHOLDS.replenishmentHotMs);

const latestPath = path.join(import.meta.dirname, '../performance/snapshot-latest.json');
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(latestPath, `${JSON.stringify(metrics, null, 2)}\n`);

db.close();
fs.rmSync(dataDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`SNAPSHOT BENCHMARK THRESHOLD FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('All snapshot benchmark thresholds passed');
}
