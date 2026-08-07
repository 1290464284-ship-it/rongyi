import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Removes credential/PII rows from the bundled legacy database before it is
 * committed. The shipped legacy DB must never contain real users, password
 * hashes, refresh tokens, or audit logs; production first start bootstraps the
 * admin from V2_ADMIN_PASSWORD instead (see src/server/infrastructure/database.ts).
 */
const appRoot = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(appRoot, 'legacy', 'dental.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error(`legacy database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
const clearedTables = [
  'User',
  'RefreshToken',
  'UsedRefreshToken',
  'AuditLog',
  'OperationLog',
];
let removed = 0;
for (const table of clearedTables) {
  const exists = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(table);
  if (!exists) continue;
  const result = db.prepare(`DELETE FROM "${table}"`).run();
  removed += result.changes;
}

db.exec('VACUUM');
db.close();

console.log(`sanitized legacy database: removed ${removed} rows from ${dbPath}`);
