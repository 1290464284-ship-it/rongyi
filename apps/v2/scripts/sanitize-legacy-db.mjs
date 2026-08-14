import fs from 'node:fs';
import os from 'node:os';
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
const confirmed = process.argv.includes('--yes') || process.env.V2_SANITIZE_CONFIRM === '1';
if (!confirmed) {
  console.error(
    'sanitize-legacy-db 会破坏性清空 User/RefreshToken/AuditLog 等表，且 VACUUM 不可逆。\n' +
      '确认无误后请显式传 --yes 或设置 V2_SANITIZE_CONFIRM=1；脚本会在修改前保留一份 .before-sanitize 备份。',
  );
  process.exit(1);
}
// 备份放系统临时目录而不是 legacy/ 下：打包时 legacy/ 会整体进安装包，
// 放在仓库内会把脱敏前的真实库 PII 一起带出去。
const backupPath = path.join(os.tmpdir(), `v2-legacy-before-sanitize-${Date.now()}.sqlite`);
fs.copyFileSync(dbPath, backupPath);

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
console.log(`pre-sanitize backup preserved at: ${backupPath}`);
