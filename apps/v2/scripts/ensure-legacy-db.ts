import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { syncLegacySchema } from '../src/server/infrastructure/legacy-schema';

const appRoot = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(appRoot, 'legacy', 'dental.sqlite');
const schemaDir = path.join(appRoot, 'legacy', 'schema');

if (fs.existsSync(dbPath)) {
  // 打包目录中的 legacy 库必须是已脱敏版本：敏感表为空，否则真实诊所数据会随安装包流出。
  const existing = new Database(dbPath, { readonly: true });
  try {
    const sensitiveTables = ['User', 'RefreshToken', 'UsedRefreshToken', 'AuditLog', 'OperationLog'];
    const dirty: string[] = [];
    for (const table of sensitiveTables) {
      const exists = existing.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      ).get(table);
      if (!exists) continue;
      const row = existing.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number };
      if (Number(row.c) > 0) dirty.push(`${table}=${row.c}`);
    }
    if (dirty.length > 0) {
      console.error(
        `legacy database must be sanitized before packaging; non-empty sensitive tables: ${dirty.join(', ')}`,
      );
      process.exit(1);
    }
  } finally {
    existing.close();
  }
  console.log(`legacy database already exists (sanitized): ${dbPath}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
try {
  syncLegacySchema(db, schemaDir);
} finally {
  db.close();
}
console.log(`generated sanitized legacy database: ${dbPath}`);
