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

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:[A-Za-z0-9_]+/g, (segment) => `{${segment.slice(1)}}`);
}

for (const route of routes) {
  const key = route.path.startsWith('/api/v2')
    ? route.path.slice('/api/v2'.length) || '/'
    : route.path;
  const openApiPath = toOpenApiPath(key);
  const parameters = [...openApiPath.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const isResourceExport = key.startsWith('/resources/') && key.endsWith('/export');
  const responseSchema = isResourceExport
    ? { type: 'string' }
    : key.startsWith('/resources/') && route.method === 'GET'
      ? { $ref: '#/components/schemas/ResourceListEnvelope' }
      : { $ref: '#/components/schemas/GenericSuccessEnvelope' };
  generatedPaths[openApiPath] = {
    ...(generatedPaths[openApiPath] ?? {}),
    [route.method.toLowerCase()]: {
      summary: `${route.method} ${openApiPath}`,
      ...(parameters.length ? { parameters } : {}),
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            [isResourceExport ? 'text/csv' : 'application/json']: { schema: responseSchema },
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
        ResourceListEnvelope: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { const: true },
            data: {
              type: 'object',
              required: ['items', 'total', 'page', 'pageSize'],
              properties: {
                items: { type: 'array', items: { type: 'object', additionalProperties: true } },
                total: { type: 'number', minimum: 0 },
                page: { type: 'number', minimum: 1 },
                pageSize: { type: 'number', minimum: 1 },
              },
            },
          },
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
