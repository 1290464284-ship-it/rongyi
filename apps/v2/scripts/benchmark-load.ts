import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createDatabase, seedDatabase } from '../src/server/infrastructure/database';
import { runMigrations } from '../src/server/infrastructure/migrations';
import { SearchService, StatsService } from '../src/server/application/read-services';
import type { AppContext } from '../src/domain/contracts';

const patientCount = 100_000;
const chargeCount = 100_000;
// 阈值取本机实测的 ~20-40 倍裕量：只拦截病态回归（缺索引/意外 O(n²)/IO 异常），
// 避免在共享 CI runner 上因正常抖动误报。低于这些值即视为性能回归。
const THRESHOLDS = {
  insertPatientsMs: 30_000,
  insertChargesMs: 30_000,
  searchMs: 5_000,
  dashboardMs: 10_000,
} as const;
const failures: string[] = [];
function report(label: string, elapsedMs: number, limitMs: number): void {
  const ok = elapsedMs <= limitMs;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${Math.round(elapsedMs)}ms (limit ${limitMs}ms)`);
  if (!ok) failures.push(`${label}: ${Math.round(elapsedMs)}ms > ${limitMs}ms`);
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-benchmark-'));
const db = createDatabase(dataDir);
seedDatabase(db);
runMigrations(db);

const context: AppContext = {
  userId: 'user-admin-001',
  clinicId: 'clinic-v2-001',
  role: 'BOSS',
  traceId: 'benchmark',
  now: () => new Date(),
};

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

const now = new Date().toISOString();
const searchTriggers = [
  'search_patient_ai',
  'search_patient_au',
  'search_patient_ad',
  'search_patient_child_update',
  'search_inventory_item_ai',
  'search_inventory_item_au',
  'search_inventory_item_ad',
  'search_supplier_ai',
  'search_supplier_au',
  'search_supplier_ad',
  'search_appointment_ai',
  'search_appointment_au',
  'search_appointment_ad',
  'search_charge_ai',
  'search_charge_au',
  'search_charge_ad',
  'search_followup_ai',
  'search_followup_au',
  'search_followup_ad',
];
for (const trigger of searchTriggers) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);

const patientTiming = performance.now();
db.transaction(() => {
  for (let i = 0; i < patientCount; i += 1) {
    insertPatient.run(`bench-patient-${i}`, context.clinicId, now, now, `BENCH-${i}`, `Patient ${String(i).padStart(6, '0')}`, `136${String(i).padStart(8, '0')}`);
  }
})();
report('insert patients', performance.now() - patientTiming, THRESHOLDS.insertPatientsMs);

const chargeTiming = performance.now();
db.transaction(() => {
  for (let i = 0; i < chargeCount; i += 1) {
    insertCharge.run(`bench-charge-${i}`, context.clinicId, now, now, `bench-patient-${i % patientCount}`, `CHG-${i}`);
  }
})();
report('insert charges', performance.now() - chargeTiming, THRESHOLDS.insertChargesMs);

db.exec(`
  INSERT INTO SearchIndex(resource, recordId, clinicId, content)
  SELECT 'Patient', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
  FROM Patient WHERE deletedAt IS NULL;
  INSERT INTO SearchIndex(resource, recordId, clinicId, content)
  SELECT 'Charge', id, clinicId,
         trim(COALESCE((SELECT name FROM Patient WHERE id = patientId), '') || ' ' || COALESCE(number, '') || ' ' || COALESCE(status, ''))
  FROM Charge WHERE deletedAt IS NULL;
`);

const search = new SearchService(db);
const searchTiming = performance.now();
const searchResults = search.search('Patient 99999', context);
report('search Patient 99999', performance.now() - searchTiming, THRESHOLDS.searchMs);
console.log(`  returned ${searchResults.length} results`);

const stats = new StatsService(db);
const dashboardTiming = performance.now();
stats.dashboard(context);
report('dashboard', performance.now() - dashboardTiming, THRESHOLDS.dashboardMs);

db.close();
fs.rmSync(dataDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`BENCHMARK THRESHOLD FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('All benchmark thresholds passed');
}
