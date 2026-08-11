import type { Migration } from './index';

export const migrations154: Migration[] = [
  {
    version: 154,
    name: 'v2-commission-rules-and-statements',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS CommissionRule (
          id TEXT PRIMARY KEY,
          clinicId TEXT,
          name TEXT NOT NULL,
          category TEXT,
          costType TEXT CHECK (costType IN ('SERVICE', 'MATERIAL') OR costType IS NULL),
          rateType TEXT NOT NULL CHECK (rateType IN ('PERCENT', 'FIXED')),
          rate INTEGER NOT NULL CHECK (rate >= 0),
          doctorId TEXT,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT,
          FOREIGN KEY (doctorId) REFERENCES User(id)
        );
        CREATE INDEX IF NOT EXISTS idx_commission_rule_clinic ON CommissionRule(clinicId, deletedAt);

        CREATE TABLE IF NOT EXISTS CommissionStatement (
          id TEXT PRIMARY KEY,
          clinicId TEXT,
          period TEXT NOT NULL,
          doctorId TEXT NOT NULL,
          totalCharged INTEGER NOT NULL DEFAULT 0,
          totalCommission INTEGER NOT NULL DEFAULT 0,
          breakdownJson TEXT NOT NULL DEFAULT '[]',
          calculatedAt TEXT NOT NULL,
          deletedAt TEXT,
          UNIQUE (clinicId, period, doctorId),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        );
        CREATE INDEX IF NOT EXISTS idx_commission_statement_clinic_period
          ON CommissionStatement(clinicId, period, deletedAt);
      `);
    },
  },
];
