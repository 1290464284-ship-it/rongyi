import { Database } from 'better-sqlite3';
import { systemTables } from './schema/system.tables';
import { patientTables } from './schema/patient.tables';
import { clinicalTables } from './schema/clinical.tables';
import { financialTables } from './schema/financial.tables';
import { pharmacyTables } from './schema/pharmacy.tables';
import { inventoryTables } from './schema/inventory.tables';
import { wechatTables } from './schema/wechat.tables';
import { analyticsTables } from './schema/analytics.tables';
import { hrTables } from './schema/hr.tables';
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
  ...analyticsTables,
  ...hrTables,
];

export const createSchema = (db: Database) => {
  for (const sql of allTables) {
    try {
      db.exec(sql);
    } catch (err: unknown) {
      // 仅容忍"对象已存在"类错误（幂等执行）；其他错误（语法/磁盘/权限）必须抛出，
      // 否则表创建失败被静默吞掉，后续业务 SQL 会以更难排查的方式失败
      const message = (err as Error)?.message || '';
      if (/already exists/i.test(message)) {
        SCHEMA_LOGGER.warn('表已存在，跳过创建', err);
        continue;
      }
      throw err;
    }
  }

  createIndexes(db);
};
