import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV48 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('CephalometricAnalysis')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS CephalometricAnalysis (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          imagingId TEXT,
          doctorId TEXT,
          name TEXT NOT NULL,
          landmarks TEXT NOT NULL,
          landmarksValidated INTEGER DEFAULT 0 CHECK (landmarksValidated IN (0,1)),
          referencePlanes TEXT NOT NULL,
          measurements TEXT NOT NULL,
          classification TEXT NOT NULL,
          comparisonTemplate TEXT,
          comparisonResult TEXT,
          notes TEXT,
          clinicId TEXT NOT NULL,
          createdBy TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY(patientId) REFERENCES Patient(id)
        )
      `);
    }

    createIndexIfNotExists(
      'IDX_CephalometricAnalysis_patient',
      'CephalometricAnalysis',
      'clinicId, patientId, createdAt DESC',
    );
    createIndexIfNotExists(
      'IDX_CephalometricAnalysis_doctor',
      'CephalometricAnalysis',
      'clinicId, doctorId, createdAt DESC',
    );
  });
  migrateTx();
  logger.log('v48: CephalometricAnalysis 表 + 2 索引');
};
