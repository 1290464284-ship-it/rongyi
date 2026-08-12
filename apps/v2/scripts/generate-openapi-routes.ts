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

const generatedPath = path.resolve(import.meta.dirname, '../openapi.generated.json');
const generatedPaths: Record<string, Record<string, unknown>> = {};
for (const route of routes) {
  const key = route.path.startsWith('/api/v2')
    ? route.path.slice('/api/v2'.length) || '/'
    : route.path;
  generatedPaths[key] = {
    ...(generatedPaths[key] ?? {}),
    [route.method.toLowerCase()]: {
      summary: `${route.method} ${key}`,
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenericSuccessEnvelope' },
            },
          },
        },
        default: {
          description: 'Error response',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
      },
    },
  };
}
fs.writeFileSync(
  generatedPath,
  `${JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Dental Clinic V2 Generated Route Inventory', version: '2.2.0' },
    paths: generatedPaths,
    components: {
      schemas: {
        GenericSuccessEnvelope: {
          type: 'object',
          required: ['success', 'data'],
          properties: { success: { const: true }, data: {} },
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['success', 'code', 'message'],
          properties: { success: { const: false }, code: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
  }, null, 2)}\n`,
);
console.log(`Wrote ${Object.keys(generatedPaths).length} generated OpenAPI paths to ${generatedPath}`);

db.close();
fs.rmSync(dataDir, { recursive: true, force: true });
