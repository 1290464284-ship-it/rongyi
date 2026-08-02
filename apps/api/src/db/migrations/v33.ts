import { addColumnIfMissing, logger, tableExists } from './helpers';

export const migrateToV33 = () => {
  if (tableExists('Visit')) {
    addColumnIfMissing('Visit', 'summary', 'TEXT');
    logger.log('v33: Visit 表已添加 summary 列');
  } else {
    logger.log('v33: Visit 表不存在，跳过 Visit 加列');
  }
};
