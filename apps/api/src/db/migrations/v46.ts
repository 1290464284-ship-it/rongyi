import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV46 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('PrintTemplate')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS PrintTemplate (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('PRESCRIPTION','FINANCIAL','CLINICAL','REPORT')),
          content TEXT NOT NULL,
          variables TEXT NOT NULL DEFAULT '{}',
          isDefault INTEGER DEFAULT 0 CHECK (isDefault IN (0,1)),
          paperSize TEXT DEFAULT 'A4' CHECK (paperSize IN ('A4','A5','RECEIPT')),
          orientation TEXT DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
          clinicId TEXT NOT NULL,
          createdBy TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, code)
        )
      `);
    }

    createIndexIfNotExists(
      'IDX_PrintTemplate_clinicId_code',
      'PrintTemplate',
      'clinicId, code',
    );
    createIndexIfNotExists(
      'IDX_PrintTemplate_clinicId_category',
      'PrintTemplate',
      'clinicId, category',
    );
  });
  migrateTx();
  logger.log('v46: PrintTemplate 表 + 2 索引');
};
