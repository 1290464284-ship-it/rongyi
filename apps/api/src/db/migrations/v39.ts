import { getMigrationDb, createIndexIfNotExists, addColumnIfMissing, logger, tableExists } from './helpers';

export const migrateToV39 = () => {
  const db = getMigrationDb();

  if (!tableExists('MedicalRecordPhrase')) {
    logger.log('v39: MedicalRecordPhrase 表不存在，跳过迁移');
    return;
  }

  const migrateTx = db.transaction(() => {
    addColumnIfMissing('MedicalRecordPhrase', 'useCount', 'INTEGER DEFAULT 0');
    addColumnIfMissing('MedicalRecordPhrase', 'triggerToothStatuses', "TEXT DEFAULT '[]'");
    addColumnIfMissing('MedicalRecordPhrase', 'triggerToothConditions', "TEXT DEFAULT '[]'");
    addColumnIfMissing('MedicalRecordPhrase', 'lastUsedAt', 'TEXT');
    addColumnIfMissing('MedicalRecordPhrase', 'copiedFromId', 'TEXT');

    createIndexIfNotExists(
      'IDX_MedicalRecordPhrase_owner_pin',
      'MedicalRecordPhrase',
      'clinicId, ownerId, pinOrder DESC, useCount DESC',
    );
  });
  migrateTx();
  logger.log('v39: MedicalRecordPhrase 已新增 useCount/triggerToothStatuses/triggerToothConditions/lastUsedAt/copiedFromId 列及复合索引');
};
