import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';
import { resetSecretFileCache } from '../infrastructure/secret-file';

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
});
