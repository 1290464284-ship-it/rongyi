import type { Migration } from './index';
import { addColumns } from './helpers';

// 迁移版本 131..140（M-04：由 v121-140.ts 拆分）
export const migrations131to140: Migration[] = [
  {
    version: 131,
    name: 'v2-charge-combos',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ChargeCombo (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'PRIVATE'
            CHECK (type IN ('PUBLIC', 'PRIVATE')),
          ownerId TEXT,
          active INTEGER DEFAULT 1,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, code)
        );
        CREATE TABLE IF NOT EXISTS ChargeComboItem (
          id TEXT PRIMARY KEY,
          comboId TEXT NOT NULL,
          catalogId TEXT,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER DEFAULT 0,
          quantity INTEGER DEFAULT 1,
          costType TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (comboId) REFERENCES ChargeCombo(id)
        );
      `);
    },
  },  {
    version: 132,
    name: 'v2-appointment-purposes',
    up(db) {
      addColumns(db, 'Appointment', [
        ['purpose', 'TEXT'],
        ['tempPatientName', 'TEXT'],
        ['tempPatientPhone', 'TEXT'],
      ]);
      addColumns(db, 'Patient', [
        ['isTempPatient', 'INTEGER DEFAULT 0'],
      ]);
      db.exec(`
        CREATE TABLE IF NOT EXISTS AppointmentPurpose (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT,
          sortOrder INTEGER DEFAULT 0,
          active INTEGER DEFAULT 1,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        );
      `);
    },
  },  {
    version: 133,
    name: 'v2-shift-templates',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ShiftTemplate (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          startTime TEXT NOT NULL,
          endTime TEXT NOT NULL,
          workDaysJson TEXT DEFAULT '[1,2,3,4,5]',
          color TEXT,
          active INTEGER DEFAULT 1,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        );
      `);
      addColumns(db, 'WorkSchedule', [
        ['shiftTemplateId', 'TEXT'],
        ['title', 'TEXT'],
        ['weekDay', 'INTEGER'],
        ['color', 'TEXT'],
        ['isRecurring', 'INTEGER DEFAULT 0'],
      ]);
    },
  },  {
    version: 134,
    name: 'v2-dispenses',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS Dispense (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL,
          chargeId TEXT,
          prescriptionId TEXT,
          patientId TEXT NOT NULL,
          doctorId TEXT,
          pharmacistId TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (status IN ('PENDING', 'PARTIAL', 'DISPENSED', 'RETURNED')),
          dispensedAt TEXT,
          returnedAt TEXT,
          note TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, number),
          FOREIGN KEY (chargeId) REFERENCES Charge(id),
          FOREIGN KEY (patientId) REFERENCES Patient(id)
        );
        CREATE TABLE IF NOT EXISTS DispenseItem (
          id TEXT PRIMARY KEY,
          dispenseId TEXT NOT NULL,
          itemId TEXT NOT NULL,
          batchId TEXT,
          name TEXT NOT NULL,
          spec TEXT,
          quantity INTEGER NOT NULL DEFAULT 1,
          returnedQuantity INTEGER DEFAULT 0,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (dispenseId) REFERENCES Dispense(id),
          FOREIGN KEY (itemId) REFERENCES InventoryItem(id)
        );
        CREATE TABLE IF NOT EXISTS NarcoticRegistry (
          id TEXT PRIMARY KEY,
          recordDate TEXT,
          patientId TEXT,
          doctorId TEXT,
          pharmacistId TEXT,
          itemId TEXT NOT NULL,
          batchNo TEXT,
          quantity INTEGER DEFAULT 0,
          unit TEXT,
          usage TEXT,
          balanceBefore INTEGER,
          balanceAfter INTEGER,
          remark TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (itemId) REFERENCES InventoryItem(id)
        );
      `);
    },
  },  {
    version: 135,
    name: 'v2-refund-processing-state',
    up(db) {
      addColumns(db, 'Refund', [
        ['status', "TEXT DEFAULT 'REQUESTED'"],
        ['approvedById', 'TEXT'],
        ['approvedAt', 'TEXT'],
        ['processedById', 'TEXT'],
        ['processedAt', 'TEXT'],
      ]);
    },
  },  {
    version: 136,
    name: 'v2-purchase-order-review',
    up(db) {
      addColumns(db, 'PurchaseOrder', [
        ['reviewStatus', "TEXT DEFAULT 'PENDING'"],
        ['approvedById', 'TEXT'],
        ['approvedAt', 'TEXT'],
        ['rejectionReason', 'TEXT'],
        ['receivedById', 'TEXT'],
      ]);
    },
  },  {
    version: 137,
    name: 'v2-processing-order-settlement',
    up(db) {
      addColumns(db, 'ProcessingOrder', [
        ['settleStatus', "TEXT DEFAULT 'UNSETTLED'"],
        ['settledAmount', 'INTEGER'],
        ['settledAt', 'TEXT'],
        ['settlementNote', 'TEXT'],
        ['settlementRef', 'TEXT'],
      ]);
    },
  },  {
    version: 138,
    name: 'v2-tech-material-separation',
    up(db) {
      addColumns(db, 'TreatmentCatalog', [
        ['costType', "TEXT DEFAULT 'SERVICE'"],
        ['anesthesia', 'INTEGER DEFAULT 0'],
      ]);
      addColumns(db, 'ChargeItem', [
        ['costType', "TEXT DEFAULT 'SERVICE'"],
      ]);
    },
  },  {
    version: 139,
    name: 'v2-multi-role-permissions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS UserRole (
          userId TEXT NOT NULL,
          role TEXT NOT NULL,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          PRIMARY KEY (userId, role),
          FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS RolePermission (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          resource TEXT NOT NULL,
          permission TEXT NOT NULL,
          allowed INTEGER DEFAULT 1,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_role_permission_unique
          ON RolePermission(role, resource, permission)
          WHERE deletedAt IS NULL;
        CREATE INDEX IF NOT EXISTS idx_v2_user_role_user ON UserRole(userId);
      `);
    },
  },  {
    version: 140,
    name: 'v2-imaging-categories',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ImagingCategory (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'OTHER'
            CHECK (type IN ('ORTHODONTIC', 'AESTHETIC', 'PLASTER', 'OTHER')),
          parentId TEXT,
          sortOrder INTEGER DEFAULT 0,
          active INTEGER DEFAULT 1,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        );
      `);
      addColumns(db, 'Imaging', [
        ['categoryId', 'TEXT'],
        ['phase', 'TEXT'],
      ]);
    },
  },
];
