import {
  getMigrationDb,
  addColumnIfMissing,
  createIndexIfNotExists,
  logger,
  tableExists,
} from './helpers';

export const migrateToV42 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    if (tableExists('InventoryReplenishmentSuggestion')) {
      addColumnIfMissing(
        'InventoryReplenishmentSuggestion',
        'status',
        "TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPLIED', 'IGNORED', 'EXPIRED'))",
      );
      addColumnIfMissing(
        'InventoryReplenishmentSuggestion',
        'reason',
        "TEXT DEFAULT 'ROP_BELOW_MIN' CHECK (reason IN ('ROP_BELOW_MIN', 'ZERO_STOCK', 'EXPIRING_30D', 'USAGE_SPIKE'))",
      );
      addColumnIfMissing(
        'InventoryReplenishmentSuggestion',
        'supplierId',
        'TEXT REFERENCES Supplier(id)',
      );
      addColumnIfMissing(
        'InventoryReplenishmentSuggestion',
        'totalAmount',
        'INTEGER DEFAULT 0',
      );
    }

    createIndexIfNotExists(
      'IDX_InvReplSuggest_clinic_status_deleted',
      'InventoryReplenishmentSuggestion',
      'clinicId, status, deletedAt',
    );
    createIndexIfNotExists(
      'IDX_InvReplSuggest_inventory_created',
      'InventoryReplenishmentSuggestion',
      'inventoryId, createdAt DESC',
    );
  });
  migrateTx();
  logger.log('v42: InventoryReplenishmentSuggestion 补齐 status/reason/supplierId/totalAmount 4 列 + 2 索引');
};
