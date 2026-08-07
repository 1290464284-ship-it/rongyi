import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { syncLegacySchema } from '../src/server/infrastructure/legacy-schema';

const appRoot = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(appRoot, 'legacy', 'dental.sqlite');
const schemaDir = path.join(appRoot, 'legacy', 'schema');

if (fs.existsSync(dbPath)) {
  console.log(`legacy database already exists: ${dbPath}`);
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
