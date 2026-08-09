import type { Migration } from './index';

export const migrations150: Migration[] = [
  {
    version: 150,
    name: 'v2-custom-fields',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS CustomField (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL,
          fieldName TEXT NOT NULL,
          label TEXT NOT NULL,
          fieldType TEXT NOT NULL
            CHECK (fieldType IN ('TEXT', 'NUMBER', 'BOOLEAN', 'SELECT')),
          optionsJson TEXT NOT NULL DEFAULT '[]',
          required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
          sortOrder INTEGER NOT NULL DEFAULT 0,
          clinicId TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_custom_field_unique
          ON CustomField(entity, fieldName, clinicId)
          WHERE deletedAt IS NULL;

        CREATE TABLE IF NOT EXISTS CustomFieldValue (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL,
          entityId TEXT NOT NULL,
          fieldId TEXT NOT NULL,
          value TEXT,
          clinicId TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT,
          FOREIGN KEY (fieldId) REFERENCES CustomField(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_custom_field_value_unique
          ON CustomFieldValue(entity, entityId, fieldId)
          WHERE deletedAt IS NULL;
      `);
    },
  },
];
