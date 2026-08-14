import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';
import { resetSecretFileCache } from '../infrastructure/secret-file';
import { AppError } from '../infrastructure/errors';
import { buildRouteDeps } from './routes/route-deps.helper';
import { registerPublicAuthRoutes, registerAdminRoutes } from './routes/auth-admin';

describe('first-run admin setup wizard', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAdminPassword = process.env.V2_ADMIN_PASSWORD;
  const previousJwtSecret = process.env.V2_JWT_SECRET;
  const previousBackupKey = process.env.V2_BACKUP_KEY;
  const previousSecretFile = process.env.V2_SECRET_FILE;

  beforeAll(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.V2_ADMIN_PASSWORD;
    delete process.env.V2_BACKUP_KEY;
    delete process.env.V2_SECRET_FILE;
    process.env.V2_JWT_SECRET = 'auth-setup-jwt-secret-0123456789abcdef';
  });

  beforeEach(() => {
    resetSecretFileCache();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-auth-setup-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    app = createApp({
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
  });

  afterAll(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAdminPassword === undefined) delete process.env.V2_ADMIN_PASSWORD;
    else process.env.V2_ADMIN_PASSWORD = previousAdminPassword;
    if (previousBackupKey === undefined) delete process.env.V2_BACKUP_KEY;
    else process.env.V2_BACKUP_KEY = previousBackupKey;
    if (previousSecretFile === undefined) delete process.env.V2_SECRET_FILE;
    else process.env.V2_SECRET_FILE = previousSecretFile;
    if (previousJwtSecret === undefined) delete process.env.V2_JWT_SECRET;
    else process.env.V2_JWT_SECRET = previousJwtSecret;
  });

  it('reports setup required before an admin exists', async () => {
    const res = await request(app).get('/api/v2/auth/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.data.setupRequired).toBe(true);
  });

  it('rejects a too-short setup password', async () => {
    const res = await request(app).post('/api/v2/auth/setup').send({ password: '123' });
    expect(res.status).toBe(400);
  });

  it('creates the initial admin and then allows login', async () => {
    const res = await request(app).post('/api/v2/auth/setup').send({ password: 'first-run-123' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: true });

    const status = await request(app).get('/api/v2/auth/setup-status');
    expect(status.body.data.setupRequired).toBe(false);
  });

  it('refuses a second setup after the admin exists', async () => {
    await request(app).post('/api/v2/auth/setup').send({ password: 'first-run-123' }).expect(200);
    const res = await request(app).post('/api/v2/auth/setup').send({ password: 'another-pass-123' });
    expect(res.status).toBe(409);
  });

  it('logs in with the wizard-created admin password', async () => {
    await request(app).post('/api/v2/auth/setup').send({ password: 'first-run-123' }).expect(200);
    const login = await request(app).post('/api/v2/auth/login').send({
      username: 'admin',
      password: 'first-run-123',
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.username).toBe('admin');
  });

  it('fail-closes when the LAN setup token is missing or too short', async () => {
    const prevLan = process.env.V2_ALLOW_INSECURE_LAN;
    const prevToken = process.env.V2_SETUP_TOKEN;
    process.env.V2_ALLOW_INSECURE_LAN = '1';
    try {
      delete process.env.V2_SETUP_TOKEN;
      const missing = await request(app).post('/api/v2/auth/setup').send({ password: 'first-run-123' });
      expect(missing.status).toBe(503);

      process.env.V2_SETUP_TOKEN = 'short';
      const short = await request(app).post('/api/v2/auth/setup').send({ password: 'first-run-123' });
      expect(short.status).toBe(503);
    } finally {
      if (prevLan === undefined) delete process.env.V2_ALLOW_INSECURE_LAN;
      else process.env.V2_ALLOW_INSECURE_LAN = prevLan;
      if (prevToken === undefined) delete process.env.V2_SETUP_TOKEN;
      else process.env.V2_SETUP_TOKEN = prevToken;
    }
  });

  it('rejects missing or wrong LAN setup tokens', async () => {
    const prevLan = process.env.V2_ALLOW_INSECURE_LAN;
    const prevToken = process.env.V2_SETUP_TOKEN;
    process.env.V2_ALLOW_INSECURE_LAN = '1';
    process.env.V2_SETUP_TOKEN = 'lan-setup-token-0123456789';
    try {
      const noHeader = await request(app).post('/api/v2/auth/setup').send({ password: 'first-run-123' });
      expect(noHeader.status).toBe(401);
      const wrong = await request(app)
        .post('/api/v2/auth/setup')
        .set('x-v2-setup-token', 'lan-setup-token-0000000000')
        .send({ password: 'first-run-123' });
      expect(wrong.status).toBe(401);
    } finally {
      if (prevLan === undefined) delete process.env.V2_ALLOW_INSECURE_LAN;
      else process.env.V2_ALLOW_INSECURE_LAN = prevLan;
      if (prevToken === undefined) delete process.env.V2_SETUP_TOKEN;
      else process.env.V2_SETUP_TOKEN = prevToken;
    }
  });

  it('accepts the matching LAN setup token', async () => {
    const prevLan = process.env.V2_ALLOW_INSECURE_LAN;
    const prevToken = process.env.V2_SETUP_TOKEN;
    process.env.V2_ALLOW_INSECURE_LAN = '1';
    process.env.V2_SETUP_TOKEN = 'lan-setup-token-0123456789';
    try {
      const ok = await request(app)
        .post('/api/v2/auth/setup')
        .set('x-v2-setup-token', 'lan-setup-token-0123456789')
        .send({ password: 'first-run-123' });
      expect(ok.status).toBe(200);
    } finally {
      if (prevLan === undefined) delete process.env.V2_ALLOW_INSECURE_LAN;
      else process.env.V2_ALLOW_INSECURE_LAN = prevLan;
      if (prevToken === undefined) delete process.env.V2_SETUP_TOKEN;
      else process.env.V2_SETUP_TOKEN = prevToken;
    }
  });

  it('falls back to noop audit, null ip, and role navigation without middleware extras', async () => {
    const deps = buildRouteDeps(db);
    const bare = express();
    bare.use(express.json());
    bare.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: undefined, configurable: true });
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test',
        now: () => new Date(),
      };
      next();
    });
    registerPublicAuthRoutes(bare, deps);
    registerAdminRoutes(bare, deps);
    bare.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    await deps.authService.setupInitialAdmin('first-run-123');
    const failedLogin = await request(bare).post('/api/v2/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(failedLogin.status).toBe(401);

    const login = await request(bare).post('/api/v2/auth/login').send({ username: 'admin', password: 'first-run-123' });
    expect(login.status).toBe(200);
    const refreshToken = String(login.body.data.refreshToken);

    const failedRefresh = await request(bare).post('/api/v2/auth/refresh').send({ refreshToken: 'bad-token' });
    expect(failedRefresh.status).toBe(401);
    const refresh = await request(bare).post('/api/v2/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(200);

    // 用轮换后的有效 token 登出：userId 命中，audit 块执行
    const logout = await request(bare).post('/api/v2/auth/logout').send({
      refreshToken: String(refresh.body.data.refreshToken),
    });
    expect(logout.status).toBe(200);

    const nav = await request(bare).get('/api/v2/auth/navigation');
    expect(nav.status).toBe(200);
    expect(nav.body.data.permissions).toBeDefined();
  });
});
