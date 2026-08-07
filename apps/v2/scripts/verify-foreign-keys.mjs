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
    name: 'ChargeItem.treatmentId -> Treatment',
    sql: `SELECT COUNT(*) AS c FROM ChargeItem CI
          LEFT JOIN Treatment T ON T.id = CI.treatmentId
          WHERE CI.treatmentId IS NOT NULL AND T.id IS NULL`,
  },
  {
    name: 'ChargeItem.inventoryItemId -> InventoryItem',
    sql: `SELECT COUNT(*) AS c FROM ChargeItem CI
          LEFT JOIN InventoryItem I ON I.id = CI.inventoryItemId
          WHERE CI.inventoryItemId IS NOT NULL AND I.id IS NULL`,
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
    name: 'InventoryTransaction.supplierId -> Supplier',
    sql: `SELECT COUNT(*) AS c FROM InventoryTransaction T
          LEFT JOIN Supplier S ON S.id = T.supplierId
          WHERE T.supplierId IS NOT NULL AND S.id IS NULL`,
  },
  {
    name: 'InventoryTransaction.operatorId -> User',
    sql: `SELECT COUNT(*) AS c FROM InventoryTransaction T
          LEFT JOIN User U ON U.id = T.operatorId
          WHERE T.operatorId IS NOT NULL AND U.id IS NULL`,
  },
  {
    name: 'PurchaseOrderItem.orderId -> PurchaseOrder',
    sql: `SELECT COUNT(*) AS c FROM PurchaseOrderItem POI
          LEFT JOIN PurchaseOrder PO ON PO.id = POI.orderId
          WHERE POI.orderId IS NOT NULL AND PO.id IS NULL`,
  },
  {
    name: 'PurchaseOrderItem.itemId -> InventoryItem',
    sql: `SELECT COUNT(*) AS c FROM PurchaseOrderItem POI
          LEFT JOIN InventoryItem I ON I.id = POI.itemId
          WHERE POI.itemId IS NOT NULL AND I.id IS NULL`,
  },
  {
    name: 'Refund.chargeId -> Charge',
    sql: `SELECT COUNT(*) AS c FROM Refund R
          LEFT JOIN Charge C ON C.id = R.chargeId
          WHERE R.chargeId IS NOT NULL AND C.id IS NULL`,
  },
  {
    name: 'Refund.patientId -> Patient',
    sql: `SELECT COUNT(*) AS c FROM Refund R
          LEFT JOIN Patient P ON P.id = R.patientId
          WHERE R.patientId IS NOT NULL AND P.id IS NULL`,
  },
  {
    name: 'Refund.operatorId -> User',
    sql: `SELECT COUNT(*) AS c FROM Refund R
          LEFT JOIN User U ON U.id = R.operatorId
          WHERE R.operatorId IS NOT NULL AND U.id IS NULL`,
  },
  {
    name: 'FollowUp.patientId -> Patient',
    sql: `SELECT COUNT(*) AS c FROM FollowUp F
          LEFT JOIN Patient P ON P.id = F.patientId
          WHERE F.patientId IS NOT NULL AND P.id IS NULL`,
  },
  {
    name: 'ProcessingOrder.patientId -> Patient',
    sql: `SELECT COUNT(*) AS c FROM ProcessingOrder PO
          LEFT JOIN Patient P ON P.id = PO.patientId
          WHERE PO.patientId IS NOT NULL AND P.id IS NULL`,
  },
  {
    name: 'ProcessingOrder.visitId -> Visit',
    sql: `SELECT COUNT(*) AS c FROM ProcessingOrder PO
          LEFT JOIN Visit V ON V.id = PO.visitId
          WHERE PO.visitId IS NOT NULL AND V.id IS NULL`,
  },
  {
    name: 'ProcessingOrder.factoryId -> ProcessingFactory',
    sql: `SELECT COUNT(*) AS c FROM ProcessingOrder PO
          LEFT JOIN ProcessingFactory F ON F.id = PO.factoryId
          WHERE PO.factoryId IS NOT NULL AND F.id IS NULL`,
  },
  {
    name: 'ProcessingOrder.doctorId -> User',
    sql: `SELECT COUNT(*) AS c FROM ProcessingOrder PO
          LEFT JOIN User U ON U.id = PO.doctorId
          WHERE PO.doctorId IS NOT NULL AND U.id IS NULL`,
  },
  {
    name: 'ProcessingOrder.chargeId -> Charge',
    sql: `SELECT COUNT(*) AS c FROM ProcessingOrder PO
          LEFT JOIN Charge C ON C.id = PO.chargeId
          WHERE PO.chargeId IS NOT NULL AND C.id IS NULL`,
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
