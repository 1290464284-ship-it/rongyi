import type { Migration } from './index';

export const migrations151: Migration[] = [
  {
    version: 151,
    name: 'v2-inventory-barcode',
    up(db) {
      const columns = (db.prepare('PRAGMA table_info(InventoryItem)').all() as Array<{ name: string }>)
        .map((column) => column.name);
      if (!columns.includes('barcode')) {
        db.exec('ALTER TABLE InventoryItem ADD COLUMN barcode TEXT');
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_item_barcode
          ON InventoryItem(clinicId, barcode)
          WHERE deletedAt IS NULL;
      `);
    },
  },
];
