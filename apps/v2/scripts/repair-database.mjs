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

const check = (db) => db.pragma('integrity_check');
const initial = new Database(dbPath, { readonly: true });
let initialOk = false;
try {
  const integrity = check(initial);
  initialOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
} finally {
  initial.close();
}

if (initialOk) {
  console.log(`database integrity ok, no repair needed: ${dbPath}`);
  process.exit(0);
}

const backupPath = `${dbPath}.pre-repair-${Date.now()}`;
fs.copyFileSync(dbPath, backupPath);
console.log(`backup created: ${backupPath}`);

const db = new Database(dbPath);
try {
  db.pragma('foreign_keys = OFF');
  db.exec('REINDEX');
  db.pragma('foreign_keys = ON');
  const integrity = check(db);
  const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  if (!ok) {
    console.error(`repair failed for: ${dbPath}`);
    for (const row of integrity) console.error(row.integrity_check);
    console.error(`restore the backup with: restore-backup.mjs`);
    process.exit(1);
  }
  console.log(`database repaired: ${dbPath}`);
  console.log(`backup preserved at: ${backupPath}`);
} finally {
  db.close();
}
