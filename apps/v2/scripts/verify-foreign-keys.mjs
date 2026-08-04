import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function resolveDatabasePath() {
  if (process.env.V2_DB_PATH) return path.resolve(process.env.V2_DB_PATH);
  const dataDir = process.env.V2_DATA_DIR
    ? path.resolve(process.env.V2_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'v2.sqlite');
}

const checks = [
  {
    name: 'Charge.patientId -> Patient',
    sql: `SELECT COUNT(*) AS c FROM Charge C
          LEFT JOIN Patient P ON P.id = C.patientId
          WHERE C.patientId IS NOT NULL AND P.id IS NULL`,
  },
  {
    name: 'ChargeItem.chargeId -> Charge',
    sql: `SELECT COUNT(*) AS c FROM ChargeItem CI
          LEFT JOIN Charge C ON C.id = CI.chargeId
          WHERE CI.chargeId IS NOT NULL AND C.id IS NULL`,
  },
  {
    name: 'MemberCard.patientId -> Patient',
    sql: `SELECT COUNT(*) AS c FROM MemberCard M
          LEFT JOIN Patient P ON P.id = M.patientId
          WHERE M.patientId IS NOT NULL AND P.id IS NULL`,
  },
  {
    name: 'InventoryTransaction.itemId -> InventoryItem',
    sql: `SELECT COUNT(*) AS c FROM InventoryTransaction T
          LEFT JOIN InventoryItem I ON I.id = T.itemId
          WHERE T.itemId IS NOT NULL AND I.id IS NULL`,
  },
  {
    name: 'PurchaseOrderItem.orderId -> PurchaseOrder',
    sql: `SELECT COUNT(*) AS c FROM PurchaseOrderItem POI
          LEFT JOIN PurchaseOrder PO ON PO.id = POI.orderId
          WHERE POI.orderId IS NOT NULL AND PO.id IS NULL`,
  },
  {
    name: 'Refund.chargeId -> Charge',
    sql: `SELECT COUNT(*) AS c FROM Refund R
          LEFT JOIN Charge C ON C.id = R.chargeId
          WHERE R.chargeId IS NOT NULL AND C.id IS NULL`,
  },
  {
    name: 'FollowUp.patientId -> Patient',
    sql: `SELECT COUNT(*) AS c FROM FollowUp F
          LEFT JOIN Patient P ON P.id = F.patientId
          WHERE F.patientId IS NOT NULL AND P.id IS NULL`,
  },
];

const dbPath = resolveDatabasePath();
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
try {
  let failed = 0;
  for (const check of checks) {
    const count = Number(db.prepare(check.sql).get().c);
    if (count > 0) {
      console.error(`${check.name}: ${count} orphan row(s)`);
      failed += 1;
    } else {
      console.log(`${check.name}: ok`);
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`foreign key integrity ok: ${dbPath}`);
} finally {
  db.close();
}
