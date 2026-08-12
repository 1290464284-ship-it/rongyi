import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/http/app';
import { createDatabase, seedDatabase } from '../src/server/infrastructure/database';
import { runMigrations } from '../src/server/infrastructure/migrations';
import { Logger } from '../src/server/infrastructure/logger';
import { collectRoutes } from '../src/server/http/route-inventory';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-openapi-routes-'));
const db = createDatabase(dataDir);
seedDatabase(db);
runMigrations(db);
const app = createApp({
  db,
  dbPath: path.join(dataDir, 'v2.sqlite'),
  backupDir: path.join(dataDir, 'backups'),
  logDir: dataDir,
  logger: new Logger(),
});

const routes = collectRoutes((app as unknown as { router: { stack: unknown[] } }).router.stack)
  .map((route) => ({
    ...route,
    path: route.path.startsWith('/:resource')
      ? `/api/v2/resources${route.path}`
      : route.path,
  }))
  .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));

const outPath = path.resolve(import.meta.dirname, '../openapi-routes.json');
fs.writeFileSync(outPath, `${JSON.stringify(routes, null, 2)}\n`);
console.log(`Wrote ${routes.length} routes to ${outPath}`);

db.close();
fs.rmSync(dataDir, { recursive: true, force: true });
