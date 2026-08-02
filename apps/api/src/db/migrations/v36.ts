import { getMigrationDb, createIndexIfNotExists, logger } from './helpers';

export const migrateToV36 = () => {
  const db = getMigrationDb();
  const migrateTx = db.transaction(() => {
    createIndexIfNotExists(
      'IDX_BusinessAlert_clinic_type_occ',
      'BusinessAlert',
      'clinicId, alertType, occurredAt',
    );
  });
  migrateTx();
  logger.log('v36: 已创建 BusinessAlert 复合索引 (clinicId, alertType, occurredAt)');
};
