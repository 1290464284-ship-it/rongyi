import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV44 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('TreatmentProgressSnapshot')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS TreatmentProgressSnapshot (
          id TEXT PRIMARY KEY,
          planId TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          plannedItems INTEGER NOT NULL DEFAULT 0,
          completedItems INTEGER NOT NULL DEFAULT 0,
          inProgressItems INTEGER NOT NULL DEFAULT 0,
          cancelledItems INTEGER NOT NULL DEFAULT 0,
          skippedItems INTEGER NOT NULL DEFAULT 0,
          plannedTotalFee INTEGER NOT NULL DEFAULT 0,
          chargedAmount INTEGER NOT NULL DEFAULT 0,
          completionPercent REAL NOT NULL DEFAULT 0,
          overdueDays INTEGER NOT NULL DEFAULT 0,
          behindSchedule INTEGER DEFAULT 0 CHECK (behindSchedule IN (0,1)),
          snapshotDate TEXT NOT NULL,
          snapshotJson TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(planId, snapshotDate)
        )
      `);
    }

    createIndexIfNotExists(
      'IDX_TreatmentProgressSnap_clinic_date',
      'TreatmentProgressSnapshot',
      'clinicId, snapshotDate DESC',
    );
    createIndexIfNotExists(
      'IDX_TreatmentProgressSnap_plan_date',
      'TreatmentProgressSnapshot',
      'planId, snapshotDate DESC',
    );
  });
  migrateTx();
  logger.log('v44: TreatmentProgressSnapshot 表 + 2 索引');
};
