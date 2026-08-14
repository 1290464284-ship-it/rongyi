import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';
import { resetSecretFileCache } from '../infrastructure/secret-file';

describe('HTTP app production CORS for packaged Electron renderer', () => {
  let dataDir: string;
  let db: Database.Database;
  let appProduction: ReturnType<typeof createApp>;
  let appElectron: ReturnType<typeof createApp>;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousElectronRenderer = process.env.V2_ELECTRON_RENDERER;
  const previousBackupKey = process.env.V2_BACKUP_KEY;
  const previousSecretFile = process.env.V2_SECRET_FILE;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.V2_ADMIN_PASSWORD = 'prod-cors-admin';
    process.env.V2_JWT_SECRET = 'prod-cors-jwt-secret-0123456789abcdef';
    // 本文件显式覆盖“生产缺备份密钥”路径；CI 工作流注入的 V2_BACKUP_KEY /
    // V2_SECRET_FILE 必须临时移除，否则用例会得到 201 而不是预期的 500。
    delete process.env.V2_BACKUP_KEY;
    delete process.env.V2_SECRET_FILE;
    // 静态导入可能已把 secret file 缓存进模块级 _cache，必须清空后测试才真正
    // 处于“无备份密钥”状态。
    resetSecretFileCache();
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

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousElectronRenderer === undefined) delete process.env.V2_ELECTRON_RENDERER;
    else process.env.V2_ELECTRON_RENDERER = previousElectronRenderer;
    if (previousBackupKey === undefined) delete process.env.V2_BACKUP_KEY;
    else process.env.V2_BACKUP_KEY = previousBackupKey;
    if (previousSecretFile === undefined) delete process.env.V2_SECRET_FILE;
    else process.env.V2_SECRET_FILE = previousSecretFile;
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

  it('rejects an http loopback origin without an explicit port (default port 80)', async () => {
    for (const app of [appProduction, appElectron]) {
      const res = await request(app).get('/api/v2/health').set('Origin', 'http://localhost');
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('rejects file uploads before writing anything when the production backup key is missing', async () => {
    const login = await request(appProduction).post('/api/v2/auth/login').send({
      username: 'admin',
      password: 'prod-cors-admin',
    });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await request(appProduction)
      .post('/api/v2/files')
      .set('authorization', `Bearer ${token}`)
      .set('x-file-name', 'missing-key.png')
      .set('content-type', 'image/png')
      .send(png);
    expect(res.status).toBe(500);
    const count = db.prepare('SELECT COUNT(*) AS count FROM FileRecord WHERE deletedAt IS NULL').get() as { count: number };
    expect(count.count).toBe(0);
    const filesDir = path.join(dataDir, 'files');
    const leftover = fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : [];
    expect(leftover).toEqual([]);
  });

  it('shares production rate-limit counters across app instances via the DB store', async () => {
    const username = `ratelimit-${Date.now()}`;
    for (let index = 0; index < 11; index += 1) {
      await request(appProduction).post('/api/v2/auth/login').send({
        username,
        password: 'definitely-wrong',
      });
    }
    const blocked = await request(appElectron).post('/api/v2/auth/login').send({
      username,
      password: 'definitely-wrong',
    });
    expect(blocked.status).toBe(429);
  });
});
