import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';

describe('request log sample rate env fallback', () => {
  let db: Database.Database | undefined;
  let dataDir: string | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    if (db) db.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('falls back to 0.01 sampling when the configured sample rate is not finite', async () => {
    vi.stubEnv('V2_REQUEST_LOG_SAMPLE_RATE', 'not-a-number');
    vi.resetModules();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sample-rate-'));
    const { createDatabase, seedDatabase } = await import('../infrastructure/database');
    const { runMigrations } = await import('../infrastructure/migrations');
    const { createApp } = await import('./app');
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    const infos: Array<Array<unknown>> = [];
    const logger = {
      info: (...args: unknown[]) => {
        infos.push(args);
      },
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const backupDir = path.join(dataDir, 'backups');
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    const app = createApp({
      db,
      dbPath: path.join(dataDir, 'v2.sqlite'),
      backupDir,
      logDir,
      logger: logger as never,
    });
    const login = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'admin', password: 'v2-test-seed-password' });
    expect(login.status).toBe(200);
    const token = String(login.body?.data?.token ?? '');
    expect(token.length).toBeGreaterThan(10);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.005);
    const res = await request(app)
      .get('/api/v2/notifications')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(infos.some(([scope, payload]) =>
      scope === 'request'
      && (payload as { method?: string; path?: string } | undefined)?.method === 'GET'
      && String((payload as { path?: string } | undefined)?.path).includes('/api/v2/notifications'),
    )).toBe(true);
    randomSpy.mockRestore();
  });
});
