import { Database } from 'better-sqlite3';
import { systemTables } from './schema/system.tables';
import { patientTables } from './schema/patient.tables';
import { clinicalTables } from './schema/clinical.tables';
import { financialTables } from './schema/financial.tables';
import { pharmacyTables } from './schema/pharmacy.tables';
import { inventoryTables } from './schema/inventory.tables';
import { wechatTables } from './schema/wechat.tables';
import { createIndexes } from './schema/indexes';

const SCHEMA_LOGGER = {
  warn: (msg: string, err?: unknown) => {
    console.warn(`[Schema] ${msg}`, err ? (err as Error)?.message || err : '');
  },
};

const allTables = [
  ...systemTables,
  ...patientTables,
  ...clinicalTables,
  ...financialTables,
  ...pharmacyTables,
  ...inventoryTables,
  ...wechatTables,
];

export const createSchema = (db: Database) => {
  for (const sql of allTables) {
    try {
      db.exec(sql);
    } catch (err: unknown) {
      SCHEMA_LOGGER.warn('创建表失败', err);
    }
  }

  createIndexes(db);
};
