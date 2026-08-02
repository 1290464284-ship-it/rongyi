 
import {
  getMigrationDb,
  createIndexIfNotExists,
  logger,
  tableExists,
  addColumnIfMissing,
} from './helpers';

export const migrateToV43 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (!tableExists('PatientRfmScore')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS PatientRfmScore (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          recencyDays INTEGER,
          frequency INTEGER,
          monetary INTEGER,
          rScore INTEGER CHECK (rScore BETWEEN 1 AND 5),
          fScore INTEGER CHECK (fScore BETWEEN 1 AND 5),
          mScore INTEGER CHECK (mScore BETWEEN 1 AND 5),
          rfmScore TEXT NOT NULL,
          segment TEXT NOT NULL,
          churnProbability REAL CHECK (churnProbability BETWEEN 0 AND 1),
          computedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, patientId),
          FOREIGN KEY(patientId) REFERENCES Patient(id)
        )
      `);
    }

    if (!tableExists('DoctorPerformanceAnomaly')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS DoctorPerformanceAnomaly (
          id TEXT PRIMARY KEY,
          doctorId TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          metric TEXT NOT NULL CHECK (metric IN ('REVENUE_30D', 'VISITS_30D', 'NO_SHOW_RATE_30D', 'AVG_AOV_30D')),
          baselineMean REAL NOT NULL,
          baselineStd REAL NOT NULL,
          sampleSize INTEGER,
          currentValue REAL NOT NULL,
          zScore REAL NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARN', 'CRITICAL')),
          detectedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          detectedAtDate TEXT,
          resolvedAt TEXT,
          note TEXT,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, doctorId, metric, detectedAtDate)
        )
      `);
    } else {
      addColumnIfMissing('DoctorPerformanceAnomaly', 'detectedAtDate', 'TEXT');
      addColumnIfMissing('DoctorPerformanceAnomaly', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    }

    createIndexIfNotExists(
      'IDX_PatientRfmScore_clinic_segment',
      'PatientRfmScore',
      'clinicId, segment',
    );
    createIndexIfNotExists(
      'IDX_DoctorPerfAnomaly_clinic_severity',
      'DoctorPerformanceAnomaly',
      'clinicId, severity, resolvedAt',
    );
  });
  migrateTx();
  logger.log('v43: PatientRfmScore + DoctorPerformanceAnomaly 表 + 2 索引');
};
