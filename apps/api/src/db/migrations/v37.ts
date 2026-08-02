import { getMigrationDb, createIndexIfNotExists, logger, columnExists, tableExists } from './helpers';

export const migrateToV37 = () => {
  const db = getMigrationDb();

  if (!tableExists('InventoryItem')) {
    logger.log('v37: InventoryItem 表不存在，跳过迁移');
    return;
  }

  const migrateTx = db.transaction(() => {
    const indexColumn = columnExists('InventoryItem', 'sku') ? 'sku' : 'code';
    createIndexIfNotExists(
      'IDX_InventoryItem_sku_clinic',
      'InventoryItem',
      `clinicId, ${indexColumn}`,
    );
  });
  migrateTx();
  logger.log(`v37: 已创建 InventoryItem 复合索引 (clinicId, code/sku)`);
};
