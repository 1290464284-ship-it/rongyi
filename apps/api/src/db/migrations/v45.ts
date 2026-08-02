import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV45 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('SatisfactionSurvey')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS SatisfactionSurvey (
          id TEXT PRIMARY KEY,
          visitId TEXT UNIQUE,
          appointmentId TEXT,
          patientId TEXT NOT NULL,
          doctorId TEXT,
          npsScore INTEGER NOT NULL CHECK (npsScore BETWEEN 0 AND 10),
          ratingMedical INTEGER CHECK (ratingMedical BETWEEN 1 AND 5),
          ratingService INTEGER CHECK (ratingService BETWEEN 1 AND 5),
          ratingEnvironment INTEGER CHECK (ratingEnvironment BETWEEN 1 AND 5),
          ratingPrice INTEGER CHECK (ratingPrice BETWEEN 1 AND 5),
          ratingWait INTEGER CHECK (ratingWait BETWEEN 1 AND 5),
          comment TEXT,
          tags TEXT DEFAULT '[]',
          source TEXT DEFAULT 'CLINIC' CHECK (source IN ('CLINIC','QR_CODE','SMS_LINK','FOLLOW_UP_CALL')),
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
      `);
    }

    if (!tableExists('NpsSnapshot')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS NpsSnapshot (
          id TEXT PRIMARY KEY,
          clinicId TEXT NOT NULL,
          snapshotDate TEXT NOT NULL,
          totalResponses INTEGER NOT NULL,
          promoters INTEGER NOT NULL,
          detractors INTEGER NOT NULL,
          passives INTEGER NOT NULL,
          nps REAL NOT NULL,
          avgRatingMedical REAL,
          avgRatingService REAL,
          avgRatingEnvironment REAL,
          avgRatingPrice REAL,
          avgRatingWait REAL,
          negativeKeywordCount TEXT DEFAULT '{}',
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, snapshotDate)
        )
      `);
    }

    createIndexIfNotExists(
      'IDX_SatSurvey_clinic_created',
      'SatisfactionSurvey',
      'clinicId, createdAt DESC',
    );
    createIndexIfNotExists(
      'IDX_NpsSnapshot_clinic_date',
      'NpsSnapshot',
      'clinicId, snapshotDate DESC',
    );
  });
  migrateTx();
  logger.log('v45: SatisfactionSurvey + NpsSnapshot 表 + 2 索引');
};
