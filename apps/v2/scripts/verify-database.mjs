import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function resolveDatabasePath() {
  if (process.env.V2_DB_PATH) return path.resolve(process.env.V2_DB_PATH);
  const dataDir = process.env.V2_DATA_DIR
    ? path.resolve(process.env.V2_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'v2.sqlite');
}

const dbPath = resolveDatabasePath();
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
try {
  const integrity = db.pragma('integrity_check');
  const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  if (!ok) {
    console.error(`Database integrity check failed: ${dbPath}`);
    for (const row of integrity) console.error(row.integrity_check);
    process.exit(1);
  }
  console.log(`database integrity ok: ${dbPath}`);
} finally {
  db.close();
}
