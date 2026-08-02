import { addColumnIfMissing, createIndexIfNotExists, logger, tableExists } from './helpers';

export const migrateToV34 = () => {
  if (tableExists('DrugContraindication')) {
    addColumnIfMissing('DrugContraindication', 'ruleId', 'TEXT');
    addColumnIfMissing('DrugContraindication', 'level', "TEXT NOT NULL DEFAULT 'WARN'");
    addColumnIfMissing('DrugContraindication', 'appliesToJson', 'TEXT');
    addColumnIfMissing('DrugContraindication', 'bidirectional', 'INTEGER DEFAULT 1');
    addColumnIfMissing('DrugContraindication', 'doseMinDailyMg', 'REAL');

    createIndexIfNotExists(
      'IDX_DrugContraindication_clinicId_level',
      'DrugContraindication',
      'clinicId, level',
    );
    createIndexIfNotExists(
      'IDX_DrugContraindication_clinicId_ruleId',
      'DrugContraindication',
      'clinicId, ruleId',
    );
    logger.log('v34: DrugContraindication 表已补齐 ruleId/level/appliesToJson/bidirectional/doseMinDailyMg 列及索引');
  } else {
    logger.log('v34: DrugContraindication 表不存在，跳过加列');
  }
};
