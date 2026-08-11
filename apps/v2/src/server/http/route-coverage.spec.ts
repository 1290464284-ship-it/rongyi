import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';
import { routeRoleRules } from './route-policy';

interface RouteLayer {
  path?: string;
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
  handle?: {
    stack?: unknown[];
  };
}

interface RouteEntry {
  method: string;
  path: string;
}

// 这些路由在通用 route-policy 之前注册，且自带显式 auth/role 或为公开端点。
const EXCLUDED_ROUTES = new Set([
  '/api/v2/health',
  '/api/v2/health/deep',
  '/api/v2/metrics',
  '/api/v2/auth/login',
  '/api/v2/auth/refresh',
  '/api/v2/auth/logout',
  '/api/v2/auth/setup-status',
  '/api/v2/auth/setup',
]);

function collectRoutes(layers: unknown[], output: RouteEntry[] = []): RouteEntry[] {
  return collectRoutesWithPrefix(layers, '', output);
}

function collectRoutesWithPrefix(
  layers: unknown[],
  prefix: string,
  output: RouteEntry[],
): RouteEntry[] {
  for (const rawLayer of layers) {
    const layer = rawLayer as RouteLayer;
    if (layer.route?.path && layer.route.methods) {
      const fullPath = prefix
        ? `${prefix.replace(/\/$/, '')}/${String(layer.route.path).replace(/^\//, '')}`
        : layer.route.path;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && method !== 'head') {
          output.push({ method: method.toUpperCase(), path: fullPath });
        }
      }
    }
    const nested = layer.handle?.stack;
    if (nested) {
      const childPrefix = prefix
        ? `${prefix.replace(/\/$/, '')}/${String(layer.path ?? '').replace(/^\//, '')}`
        : layer.path ?? '';
      collectRoutesWithPrefix(nested, childPrefix, output);
    }
  }
  return output;
}

describe('route policy coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-route-coverage-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    app = createApp({
      db,
      dbPath: path.join(dataDir, 'v2.sqlite'),
      backupDir: path.join(dataDir, 'backups'),
      logDir: dataDir,
      logger: new Logger({ logDir: dataDir }),
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('every registered protected route is covered by routeRoleRules', () => {
    const routes = collectRoutes((app as unknown as { router: { stack: unknown[] } }).router.stack);
    expect(routes.length).toBeGreaterThan(100);
    for (const route of routes) {
      if (EXCLUDED_ROUTES.has(route.path)) continue;
      // 通用资源路由由 app.use('/api/v2/resources', router) 挂载，Express 暴露的是相对路径。
      const normalizedPath = route.path.startsWith('/:resource')
        ? `/api/v2/resources${route.path}`
        : route.path;
      expect(
        routeRoleRules.some((rule) => rule.pattern.test(normalizedPath)),
        `${route.method} ${normalizedPath}`,
      ).toBe(true);
    }
  });
});
