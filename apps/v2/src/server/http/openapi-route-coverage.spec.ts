import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { collectRoutes } from './route-inventory';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:[A-Za-z0-9_]+/g, (segment) => `{${segment.slice(1)}}`);
}

describe('OpenAPI route inventory coverage', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-openapi-route-coverage-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    app = createApp({
      db,
      dbPath: path.join(dataDir, 'v2.sqlite'),
      backupDir: path.join(dataDir, 'backups'),
      logDir: dataDir,
      logger: new Logger(),
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps every registered route represented in openapi-routes.json', () => {
    const live = collectRoutes((app as unknown as { router: { stack: unknown[] } }).router.stack)
      .map((route) => ({
        ...route,
        path: route.path.startsWith('/:resource')
          ? `/api/v2/resources${route.path}`
          : route.path,
      }));
    const inventory = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../../openapi-routes.json'), 'utf8'),
    ) as Array<{ method: string; path: string }>;
    const indexed = new Set(inventory.map((route) => `${route.method} ${route.path}`));
    for (const route of live) {
      expect(indexed.has(`${route.method} ${route.path}`), `${route.method} ${route.path}`).toBe(true);
    }

    const generated = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../../openapi.generated.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> };
    for (const route of live) {
      const key = route.path.startsWith('/api/v2')
        ? route.path.slice('/api/v2'.length) || '/'
        : route.path;
      const openApiPath = toOpenApiPath(key);
      expect(generated.paths[openApiPath]?.[route.method.toLowerCase()], `${route.method} ${openApiPath}`).toBeDefined();
    }
  });

  it('generates OpenAPI path templates with declared path parameters', () => {
    const generated = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../../openapi.generated.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, { parameters?: Array<{ name: string }> }>> };
    for (const [pathKey, operations] of Object.entries(generated.paths)) {
      expect(pathKey).not.toContain(':');
      const pathParams = [...pathKey.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      if (pathParams.length === 0) continue;
      for (const operation of Object.values(operations)) {
        const declared = operation.parameters?.map((parameter) => parameter.name) ?? [];
        expect(declared).toEqual(expect.arrayContaining(pathParams));
      }
    }
  });
});
