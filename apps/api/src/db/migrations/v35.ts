import { getMigrationDb, createIndexIfNotExists, logger } from './helpers';

export const migrateToV35 = () => {
  const db = getMigrationDb();
  const migrateTx = db.transaction(() => {
    createIndexIfNotExists(
      'IDX_PatientRiskScore_clinic_patient_created',
      'PatientRiskScore',
      'clinicId, patientId, createdAt DESC',
    );
  });
  migrateTx();
  logger.log('v35: 已创建 PatientRiskScore 复合索引 (clinicId, patientId, createdAt DESC)');
};
