import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';

describe('HTTP app production CORS for packaged Electron renderer', () => {
  let dataDir: string;
  let db: Database.Database;
  let appProduction: ReturnType<typeof createApp>;
  let appElectron: ReturnType<typeof createApp>;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousElectronRenderer = process.env.V2_ELECTRON_RENDERER;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.V2_ADMIN_PASSWORD = 'prod-cors-admin';
    process.env.V2_JWT_SECRET = 'prod-cors-jwt-secret-0123456789abcdef';
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-http-cors-prod-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    process.env.V2_ELECTRON_RENDERER = '0';
    appProduction = createApp({
      db,
      dbPath: path.join(dataDir, 'v2.sqlite'),
      backupDir: path.join(dataDir, 'backups'),
      logDir: path.join(dataDir, 'logs'),
      logger: new Logger({ logDir: path.join(dataDir, 'logs') }),
    });

    process.env.V2_ELECTRON_RENDERER = '1';
    appElectron = createApp({
      db,
      dbPath: path.join(dataDir, 'v2.sqlite'),
      backupDir: path.join(dataDir, 'backups'),
      logDir: path.join(dataDir, 'logs'),
      logger: new Logger({ logDir: path.join(dataDir, 'logs') }),
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousElectronRenderer === undefined) delete process.env.V2_ELECTRON_RENDERER;
    else process.env.V2_ELECTRON_RENDERER = previousElectronRenderer;
  });

  it('rejects file:// and null origins in production without the Electron flag', async () => {
    for (const origin of ['null', 'file://C:/app/dist-web/index.html']) {
      const res = await request(appProduction).get('/api/v2/health').set('Origin', origin);
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('allows file:// and null origins in production when the API is spawned by Electron', async () => {
    const fileOrigin = 'file://C:/app/dist-web/index.html';
    for (const origin of ['null', fileOrigin]) {
      const res = await request(appElectron).get('/api/v2/health').set('Origin', origin);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('keeps the loopback API port allowed in production', async () => {
    const origin = 'http://127.0.0.1:3180';
    for (const app of [appProduction, appElectron]) {
      const res = await request(app).get('/api/v2/health').set('Origin', origin);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });
});
