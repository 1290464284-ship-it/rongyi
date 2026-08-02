import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV41 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('ChargeAssociationRule')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ChargeAssociationRule (
          id TEXT PRIMARY KEY,
          clinicId TEXT NOT NULL,
          antecedent TEXT NOT NULL,
          consequent TEXT NOT NULL,
          antecedentSize INTEGER NOT NULL CHECK (antecedentSize >= 1),
          support REAL NOT NULL CHECK (support >= 0 AND support <= 1),
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          lift REAL NOT NULL,
          supportCount INTEGER NOT NULL DEFAULT 0 CHECK (supportCount >= 0),
          totalTransactions INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          computedAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      const addCol = (name: string, def: string) => {
        try {
          db.prepare(`ALTER TABLE ChargeAssociationRule ADD COLUMN ${name} ${def}`).run();
        } catch {
          /* ignore if exists */
        }
      };
      addCol('clinicId', 'TEXT NOT NULL DEFAULT ""');
      addCol('antecedent', 'TEXT NOT NULL DEFAULT "[]"');
      addCol('consequent', 'TEXT NOT NULL DEFAULT ""');
      addCol('antecedentSize', 'INTEGER NOT NULL DEFAULT 1 CHECK (antecedentSize >= 1)');
      addCol('support', 'REAL NOT NULL DEFAULT 0 CHECK (support >= 0 AND support <= 1)');
      addCol('confidence', 'REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1)');
      addCol('lift', 'REAL NOT NULL DEFAULT 0');
      addCol('supportCount', 'INTEGER NOT NULL DEFAULT 0 CHECK (supportCount >= 0)');
      addCol('totalTransactions', 'INTEGER NOT NULL DEFAULT 0');
      addCol('createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
      addCol('updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
      addCol('computedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    }

    createIndexIfNotExists(
      'IDX_ChargeAssociationRule_clinic_antecedent_cons',
      'ChargeAssociationRule',
      'clinicId, antecedent, consequent',
    );
    createIndexIfNotExists(
      'IDX_ChargeAssociationRule_clinic_confidence',
      'ChargeAssociationRule',
      'clinicId, antecedentSize, confidence DESC, lift DESC',
    );

    if (!tableExists('ChargeAssociationIgnore')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ChargeAssociationIgnore (
          id TEXT PRIMARY KEY,
          clinicId TEXT NOT NULL,
          antecedent TEXT NOT NULL,
          consequent TEXT NOT NULL,
          ignoredAt TEXT DEFAULT CURRENT_TIMESTAMP,
          ignoredBy TEXT NOT NULL
        )
      `);
    } else {
      const addCol = (name: string, def: string) => {
        try {
          db.prepare(`ALTER TABLE ChargeAssociationIgnore ADD COLUMN ${name} ${def}`).run();
        } catch {
          /* ignore if exists */
        }
      };
      addCol('clinicId', 'TEXT NOT NULL DEFAULT ""');
      addCol('antecedent', 'TEXT NOT NULL DEFAULT "[]"');
      addCol('consequent', 'TEXT NOT NULL DEFAULT ""');
      addCol('ignoredAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
      addCol('ignoredBy', 'TEXT NOT NULL DEFAULT ""');
    }

    createIndexIfNotExists(
      'IDX_ChargeAssociationIgnore_clinic',
      'ChargeAssociationIgnore',
      'clinicId, antecedent, consequent',
    );
  });
  migrateTx();
  logger.log('v41: ChargeAssociationRule + ChargeAssociationIgnore 表及 3 个索引已创建');
};
