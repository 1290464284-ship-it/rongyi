import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp, type AuditInput } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { rebuildSearchIndex } from '../infrastructure/search-index';
import { Logger } from '../infrastructure/logger';

describe('HTTP app', () => {
  let dbPath: string;
  let dataDir: string;
  let backupDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let deviceToken: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-http-'));
    dbPath = path.join(dataDir, 'v2.sqlite');
    backupDir = path.join(dataDir, 'backups');
    db = createDatabase(dataDir, dbPath);
    seedDatabase(db);
    runMigrations(db);
    app = createApp({
      db,
      dbPath,
      backupDir,
      logDir: dataDir,
      logger: new Logger({ logDir: dataDir }),
    });
    const login = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'admin123' });
    token = login.body.data.token;
    const device = await request(app)
      .post('/api/v2/sync/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'http', name: 'HTTP Test' })
      .expect(201);
    deviceToken = device.body.data.token;
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports health and deep health', async () => {
    const health = await request(app).get('/api/v2/health').expect(200);
    expect(health.body.data.status).toBe('ok');
    const deep = await request(app)
      .get('/api/v2/health/deep')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deep.body.data.database).toBe('ok');
  });

  it('allows null origin from Electron file:// renderer with CORS', async () => {
    const response = await request(app)
      .get('/api/v2/health')
      .set('Origin', 'null')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('null');
  });

  it('allows file:// origins and echoes them in the CORS header', async () => {
    const response = await request(app)
      .get('/api/v2/health')
      .set('Origin', 'file://C:/app/dist-web/index.html')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('file://C:/app/dist-web/index.html');
  });

  it('rejects untrusted origins without a CORS allow header', async () => {
    const response = await request(app)
      .get('/api/v2/health')
      .set('Origin', 'https://evil.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects loopback origins on ports other than the API and Vite dev ports', async () => {
    const response = await request(app)
      .get('/api/v2/health')
      .set('Origin', 'http://127.0.0.1:9999');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the configured API port and the Vite dev port as CORS origins', async () => {
    const api = await request(app)
      .get('/api/v2/health')
      .set('Origin', 'http://127.0.0.1:3180')
      .expect(200);
    expect(api.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3180');

    const dev = await request(app)
      .get('/api/v2/health')
      .set('Origin', 'http://localhost:5180')
      .expect(200);
    expect(dev.headers['access-control-allow-origin']).toBe('http://localhost:5180');
  });

  it('uploads and serves allowed files', async () => {
    const upload = await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'sample.png')
      .set('x-patient-id', 'patient-demo-001')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .expect(201);
    expect(upload.body.data.url).toMatch(/^\/api\/v2\/files\//);

    const download = await request(app)
      .get(upload.body.data.url as string)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(download.body).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    for (const [mime, extension] of [
      ['image/jpeg', '.jpg'],
      ['image/webp', '.webp'],
      ['application/pdf', '.pdf'],
    ]) {
      const magic = mime === 'image/jpeg'
        ? Buffer.from([0xff, 0xd8, 0xff])
        : mime === 'image/webp'
          ? Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
          : Buffer.from('%PDF');
      const fallback = await request(app)
        .post('/api/v2/files')
        .set('Authorization', `Bearer ${token}`)
        .set('content-type', mime)
        .send(magic)
        .expect(201);
      expect(fallback.body.data.url).toContain(extension);
    }

    const jpegNamed = await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'image.jpeg')
      .send(Buffer.from([0xff, 0xd8, 0xff]))
      .expect(201);
    expect(jpegNamed.body.data.url).toContain('.jpeg');

    const pngFallback = await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .expect(201);
    expect(pngFallback.body.data.url).toContain('.png');

    const namedFallback = await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('x-file-name', 'named.png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .expect(201);
    expect(namedFallback.body.data.url).toContain('.png');
  });

  it('rejects uploads with 413 when the per-user file count quota is reached', async () => {
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO FileRecord (
         id, clinicId, patientId, filename, originalName, mimeType, fileSize,
         createdBy, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, NULL, ?, 'quota.png', 'image/png', 1, 'user-admin-001', ?, ?, NULL)`,
    );
    try {
      for (let i = 0; i < 200; i += 1) {
        insert.run(`quota-${i}`, 'clinic-v2-001', `quota-${i}.png`, now, now);
      }
      const response = await request(app)
        .post('/api/v2/files')
        .set('Authorization', `Bearer ${token}`)
        .set('content-type', 'image/png')
        .set('x-file-name', 'quota-test.png')
        .send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        .expect(413);
      expect(response.body.code).toBe('QUOTA_EXCEEDED');
    } finally {
      db.prepare("DELETE FROM FileRecord WHERE createdBy = 'user-admin-001' AND id LIKE 'quota-%'").run();
    }
  });

  it('rejects uploads with 413 when the per-user byte quota is reached', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FileRecord (
         id, clinicId, patientId, filename, originalName, mimeType, fileSize,
         createdBy, createdAt, updatedAt, deletedAt
       ) VALUES ('quota-bytes', 'clinic-v2-001', NULL, 'quota-bytes.png', 'quota.png', 'image/png', ?,
         'user-admin-001', ?, ?, NULL)`,
    ).run(500 * 1024 * 1024, now, now);
    try {
      const response = await request(app)
        .post('/api/v2/files')
        .set('Authorization', `Bearer ${token}`)
        .set('content-type', 'image/png')
        .set('x-file-name', 'quota-bytes-test.png')
        .send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        .expect(413);
      expect(response.body.code).toBe('QUOTA_EXCEEDED');
    } finally {
      db.prepare("DELETE FROM FileRecord WHERE id = 'quota-bytes'").run();
    }
  });

  it('isolates uploaded files by clinic and rejects fake file magic', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-2', 'Clinic Two', 1)`,
    ).run('clinic-v2-002', now, now);
    db.prepare(
      `INSERT INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, 'BOSS', ?, ?, NULL)`,
    ).run('user-admin-001', 'clinic-v2-002', now, now);

    const upload = await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'tenant.png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
      .expect(201);
    const switched = await request(app)
      .post('/api/v2/auth/switch-clinic')
      .set('Authorization', `Bearer ${token}`)
      .send({ clinicId: 'clinic-v2-002' })
      .expect(200);
    await request(app)
      .get(upload.body.data.url as string)
      .set('Authorization', `Bearer ${switched.body.data.token}`)
      .expect(404);
    const back = await request(app)
      .post('/api/v2/auth/switch-clinic')
      .set('Authorization', `Bearer ${switched.body.data.token}`)
      .send({ clinicId: 'clinic-v2-001' })
      .expect(200);
    token = back.body.data.token;

    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'fake.png')
      .send(Buffer.from('not-a-png'))
      .expect(400);
  });

  it('rejects unsupported file uploads and invalid file names', async () => {
    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'application/x-msdownload')
      .set('x-file-name', 'virus.exe')
      .send(Buffer.from('MZ'))
      .expect(400);
    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'missing.png')
      .expect(400);
    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'text/plain')
      .expect(400);
    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'patient-missing.png')
      .set('x-patient-id', 'patient-does-not-exist')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .expect(404);
    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'large.png')
      .send(Buffer.alloc(20 * 1024 * 1024 + 1))
      .expect(400);
    await request(app)
      .get('/api/v2/files/000000000000000000000000000000000000.png')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app)
      .get('/api/v2/files/not-a-real-file.png')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('handles null-clinic uploads and missing file records on disk', async () => {
    const now = new Date().toISOString();
    const hash = (db.prepare("SELECT passwordHash FROM User WHERE id = 'user-admin-001'").get() as { passwordHash: string }).passwordHash;
    db.prepare(
      `INSERT INTO User (
         id, clinicId, currentClinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, NULL, NULL, ?, ?, NULL, 'file-null-clinic', ?, 'File Null Clinic', 'RECEPTIONIST', 1, 0, 0)`,
    ).run('user-file-null', now, now, hash);
    // 用户行 clinicId 为 NULL 时必须经 UserClinic 成员关系解析诊所作用域（迁移 121 后严格隔离）。
    db.prepare(
      `INSERT INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, 'RECEPTIONIST', ?, ?, NULL)`,
    ).run('user-file-null', 'clinic-v2-001', now, now);
    const nullLogin = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'file-null-clinic', password: 'admin123' })
      .expect(200);
    await request(app)
      .post('/api/v2/files')
      .set('Authorization', `Bearer ${nullLogin.body.data.token}`)
      .set('content-type', 'image/png')
      .set('x-file-name', 'null-clinic.png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .expect(201);

    db.prepare(
      `INSERT INTO FileRecord (
         id, clinicId, patientId, filename, originalName, mimeType, fileSize,
         createdBy, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, NULL, ?, 'missing.png', 'image/png', 1, 'user-admin-001', ?, ?, NULL)`,
    ).run('file-missing-disk', 'clinic-v2-001', '00000000-0000-4000-8000-000000000001.png', now, now);
    await request(app)
      .get('/api/v2/files/00000000-0000-4000-8000-000000000001.png')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);
  });

  it('creates purchase and processing orders through the HTTP API', async () => {
    const purchase = await request(app)
      .post('/api/v2/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        number: 'PO-HTTP-NEW',
        requestId: 'po-http-id',
        items: [{ itemId: 'inventory-demo-001', name: 'Dental Material', quantity: 1, unitPrice: 100 }],
      })
      .expect(201);
    expect(purchase.body.data.status).toBe('PENDING');
    await request(app)
      .post('/api/v2/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        number: 'PO-HTTP-NOID',
        items: [{ name: 'No Id Item', quantity: 1, unitPrice: 10 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v2/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    const processing = await request(app)
      .post('/api/v2/processing-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 'patient-demo-001',
        number: 'PROC-HTTP',
        totalFee: 500,
        requestId: 'proc-http-id',
        items: [{ name: 'Crown', quantity: 1, unitPrice: 500 }],
      })
      .expect(201);
    expect(processing.body.data.status).toBe('DRAFT');
    await request(app)
      .post('/api/v2/processing-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 'patient-demo-001',
        number: 'PROC-HTTP-NOID',
        totalFee: 100,
        items: [{ name: 'No Id Crown', quantity: 1, unitPrice: 100 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v2/processing-orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('denies sensitive routes to low-privilege roles', async () => {
    await request(app)
      .post('/api/v2/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'tech-audit', password: 'password123', name: 'Tech Audit', role: 'TECHNICIAN' })
      .expect(201);
    const login = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'tech-audit', password: 'password123' })
      .expect(200);
    const techToken = login.body.data.token as string;
    for (const path of [
      '/api/v2/stats/revenue',
      '/api/v2/analytics/rfm',
      '/api/v2/search?q=Smoke',
      '/api/v2/hr/attendance',
    ]) {
      await request(app).get(path).set('Authorization', `Bearer ${techToken}`).expect(403);
    }
    await request(app)
      .post('/api/v2/follow-ups/batch-generate')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ limit: 1 })
      .expect(403);
    const techNav = await request(app)
      .get('/api/v2/auth/navigation')
      .set('Authorization', `Bearer ${techToken}`)
      .expect(200);
    expect(techNav.body.data.permissions).not.toContain('analytics');
    expect(techNav.body.data.permissions).not.toContain('system');
    const bossNav = await request(app)
      .get('/api/v2/auth/navigation')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(bossNav.body.data.permissions).toContain('analytics');
    expect(bossNav.body.data.permissions).toContain('system');
  });

  it('restricts wechat send-batch to BOSS/ADMIN but keeps single send for operational staff', async () => {
    await request(app)
      .post('/api/v2/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'reception-wechat', password: 'password123', name: 'Reception Wechat', role: 'RECEPTIONIST' })
      .expect(201);
    const login = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'reception-wechat', password: 'password123' })
      .expect(200);
    const receptionToken = login.body.data.token as string;

    await request(app)
      .post('/api/v2/wechat/send-batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({})
      .expect(403);

    const wechat = await request(app)
      .post('/api/v2/resources/wechatMessages')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ patientId: 'patient-demo-001', type: 'TEXT', content: 'hello', status: 'PENDING' })
      .expect(201);
    await request(app)
      .post(`/api/v2/wechat/${wechat.body.data.id}/send`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({})
      .expect(409);
  });

  it('sends a wechat message only once per Idempotency-Key', async () => {
    const previousUrl = process.env.V2_WECHAT_API_URL;
    const previousAppId = process.env.V2_WECHAT_APP_ID;
    const previousSecret = process.env.V2_WECHAT_APP_SECRET;
    process.env.V2_WECHAT_API_URL = 'https://wechat.test';
    process.env.V2_WECHAT_APP_ID = 'wechat-app';
    process.env.V2_WECHAT_APP_SECRET = 'wechat-secret';
    // 独立 app 实例以便注入已配置的 wechat provider（共享 app 在 beforeAll 时无渠道配置）。
    const isolatedApp = createApp({
      db,
      dbPath,
      backupDir,
      logDir: dataDir,
      logger: new Logger({ logDir: dataDir }),
    });
    if (previousUrl === undefined) delete process.env.V2_WECHAT_API_URL; else process.env.V2_WECHAT_API_URL = previousUrl;
    if (previousAppId === undefined) delete process.env.V2_WECHAT_APP_ID; else process.env.V2_WECHAT_APP_ID = previousAppId;
    if (previousSecret === undefined) delete process.env.V2_WECHAT_APP_SECRET; else process.env.V2_WECHAT_APP_SECRET = previousSecret;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: 'sent' }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const created = await request(isolatedApp)
        .post('/api/v2/resources/wechatMessages')
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId: 'patient-demo-001', type: 'TEXT', content: 'idempotent send', status: 'PENDING' })
        .expect(201);
      const first = await request(isolatedApp)
        .post(`/api/v2/wechat/${created.body.data.id}/send`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'wechat-send-idem')
        .send({})
        .expect(200);
      const second = await request(isolatedApp)
        .post(`/api/v2/wechat/${created.body.data.id}/send`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'wechat-send-idem')
        .send({})
        .expect(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.body).toEqual(first.body);
      expect(first.body.data.status).toBe('SENT');
    } finally {
      vi.unstubAllGlobals();
      db.prepare("DELETE FROM WechatMessage WHERE content = 'idempotent send'").run();
      db.prepare("DELETE FROM IdempotencyRecord WHERE operation LIKE 'wechat.send.%'").run();
    }
  });

  it('audits forbidden attempts', async () => {
    await request(app)
      .post('/api/v2/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'tech-audit-403', password: 'password123', name: 'Tech Audit 403', role: 'TECHNICIAN' })
      .expect(201);
    const login = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'tech-audit-403', password: 'password123' })
      .expect(200);
    const techToken = login.body.data.token as string;
    const techUserId = (db.prepare(`SELECT id FROM User WHERE username = 'tech-audit-403'`).get() as { id: string }).id;

    const before = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    await request(app)
      .post('/api/v2/follow-ups/batch-generate')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ limit: 1 })
      .expect(403);
    const after = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    expect(after).toBe(before + 1);

    const row = db.prepare(
      `SELECT action, statusCode, userId FROM OperationLog ORDER BY createdAt DESC, rowid DESC LIMIT 1`,
    ).get() as { action: string; statusCode: string | null; userId: string };
    expect(row.action).toContain('POST /api/v2/follow-ups/batch-generate');
    expect(row.statusCode).toBe('403');
    expect(row.userId).toBe(techUserId);
  });

  it('does not audit GET requests', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    await request(app)
      .get('/api/v2/resources/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const after = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it('records failed validation requests', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    await request(app)
      .post('/api/v2/resources/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    const after = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    expect(after).toBe(before + 1);
    const row = db.prepare(
      `SELECT action, statusCode FROM OperationLog ORDER BY createdAt DESC, rowid DESC LIMIT 1`,
    ).get() as { action: string; statusCode: string | null };
    expect(row.statusCode).toBe('400');
  });

  it('rejects malformed print query data with a validation error', async () => {
    const response = await request(app)
      .get('/api/v2/print?kind=report&data=%7B%22bad%22')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown non-v2 routes', async () => {
    const response = await request(app).get('/not-a-v2-route').expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('creates, verifies, and stages backups through the HTTP API', async () => {
    const created = await request(app)
      .post('/api/v2/backups')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(created.body.data.filename).toBeDefined();

    const filename = created.body.data.filename as string;
    await request(app)
      .get(`/api/v2/backups/${encodeURIComponent(filename)}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .post(`/api/v2/backups/${encodeURIComponent(filename)}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
  });

  it('covers remaining workflow and system route success branches', async () => {
    const wechat = await request(app)
      .post('/api/v2/resources/wechatMessages')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', type: 'TEXT', content: 'hello', status: 'PENDING' })
      .expect(201);
    await request(app)
      .post(`/api/v2/wechat/${wechat.body.data.id}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
    await request(app)
      .get('/api/v2/wechat/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.configured).toBe(false);
      });

    const purchaseNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-HTTP', NULL, 0, 'PENDING')`,
    ).run('po-http', 'clinic-v2-001', purchaseNow, purchaseNow);
    await request(app)
      .patch('/api/v2/purchase-orders/po-http/receive')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    await request(app)
      .get('/api/v2/purchase-orders/po-http/items')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app).get('/api/v2/satisfaction/doctor-rankings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v2/stats/inventory')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v2/follow-ups/adherence')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v2/backups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const leave = await request(app)
      .post('/api/v2/resources/leaveRequests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userId: 'user-admin-001',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        type: 'ANNUAL',
        reason: 'http leave',
        status: 'PENDING',
      })
      .expect(201);
    await request(app)
      .patch(`/api/v2/hr/leaves/${leave.body.data.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ approved: true })
      .expect(200);
  });

  it('returns resource metadata and creates a patient', async () => {
    const meta = await request(app).get('/api/v2/resource-meta').set('Authorization', `Bearer ${token}`).expect(200);
    expect(meta.body.data.length).toBeGreaterThan(50);
    const created = await request(app).post('/api/v2/resources/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'HTTP-001',
        name: 'HTTP Patient',
        gender: 'UNKNOWN',
        phone: '13611112222',
        source: 'WALK_IN',
        active: true,
      })
      .expect(201);
    expect(created.body.data.id).toBeDefined();
  });

  it('creates a charge, pays it, and refunds it', async () => {
    const charge = await request(app).post('/api/v2/charges')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 'patient-demo-001',
        items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
      })
      .expect(201);
    await request(app).patch(`/api/v2/charges/${charge.body.data.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, method: 'CASH', requestId: 'http-pay-1' })
      .expect(200);
    await request(app).post(`/api/v2/charges/${charge.body.data.id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50, reason: 'test', requestId: 'http-refund-1' })
      .expect(200);
  });

  it('creates an inventory transaction and returns dashboard stats', async () => {
    await request(app).post('/api/v2/inventory/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 1 })
      .expect(201);
    const stats = await request(app).get('/api/v2/stats/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(stats.body.data).toHaveProperty('patients');
  });

  it('creates backups and renders print output', async () => {
    const backup = await request(app).post('/api/v2/backups')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(backup.body.data.filename).toBeDefined();
    const print = await request(app).get('/api/v2/print?kind=report&data=%7B%22title%22%3A%22HTTP%22%7D')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(print.text).toContain('HTTP');
    const printPost = await request(app).post('/api/v2/print')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'report', data: { title: 'POST-HTTP' } })
      .expect(200);
    expect(printPost.text).toContain('POST-HTTP');
    const printPostDefaults = await request(app).post('/api/v2/print')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    expect(printPostDefaults.text).toContain('report');
  });

  it('supports auth profile, password change, and resource CRUD', async () => {
    const me = await request(app).get('/api/v2/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.data.username).toBe('admin');
    await request(app).patch('/api/v2/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'admin123', newPassword: 'newpass123' })
      .expect(200);
    const relogin = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'newpass123' }).expect(200);
    token = relogin.body.data.token;
    // 资源列表 search 已走 FTS；迁移 119 移除触发器后需显式重建索引（运行时插入的行不会自动入索引）。
    rebuildSearchIndex(db);
    const patients = await request(app).get('/api/v2/resources/patients?search=HTTP')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patients.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('lists active doctors for appointment scheduling', async () => {
    await request(app)
      .post('/api/v2/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'doctor-http', password: 'password123', name: 'HTTP Doctor', role: 'DOCTOR' })
      .expect(201);
    const doctors = await request(app)
      .get('/api/v2/doctors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(doctors.body.data.some((entry: { name: string }) => entry.name === 'HTTP Doctor')).toBe(true);
  });

  it('creates a follow-up template with fractional default multipliers', async () => {
    const res = await request(app)
      .post('/api/v2/resources/followUpTemplates')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'T1', daysAfter: 3, minIntervalDays: 7, recommendedIntervalDays: 14, maxIntervalDays: 30 });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    const row = db.prepare('SELECT riskMultiplierHigh, riskMultiplierExtreme FROM FollowUpTemplate WHERE id = ?').get(id) as {
      riskMultiplierHigh: number; riskMultiplierExtreme: number;
    };
    expect(Number(row.riskMultiplierHigh)).toBeCloseTo(0.75, 5);
    expect(Number(row.riskMultiplierExtreme)).toBeCloseTo(0.5, 5);
  });

  it('supports appointments, follow-ups, analytics, sync, HR, alerts, notifications, and satisfaction', async () => {
    const appointmentStart = new Date(Date.UTC(2100, 5, 1) + Math.random() * 1000000000000).toISOString();
    const appointment = await request(app).post('/api/v2/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        startTime: appointmentStart,
        endTime: new Date(new Date(appointmentStart).getTime() + 3600000).toISOString(),
        type: 'REGULAR',
      })
      .expect(201);
    await request(app).patch(`/api/v2/appointments/${appointment.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARRIVED' })
      .expect(200);

    await request(app).post('/api/v2/follow-ups/batch-generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ limit: 1 })
      .expect(200);
    await request(app).get('/api/v2/follow-ups/reminders').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/follow-ups/reminders/summary').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/analytics/rfm').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/analytics/churn').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/analytics/doctor-anomalies').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/analytics/clinic-overview').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get(`/api/v2/sync/pull?since=2020-01-01T00:00:00.000Z&deviceId=http&deviceToken=${encodeURIComponent(deviceToken)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v2/hr/attendance').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/system/business-alerts').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/satisfaction/nps').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/satisfaction/trend').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/search?q=Demo').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('queries appointments by local date through the read endpoint', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-by-date-http', 'clinic-v2-001', now, now, '2026-08-05T02:00:00.000Z', '2026-08-05T03:00:00.000Z');
    try {
      const hit = await request(app)
        .get('/api/v2/appointments/by-date?date=2026-08-05')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(hit.body.data.items.some((item: { id: string }) => item.id === 'appointment-by-date-http')).toBe(true);
      // relation label 随 by-date 返回（白名单 LEFT JOIN），供看板显示姓名而非 UUID。
      const hitRow = hit.body.data.items.find(
        (item: { id: string }) => item.id === 'appointment-by-date-http',
      ) as Record<string, unknown>;
      expect(hitRow.patientIdLabel).toBe('Demo Patient');
      expect(hitRow.doctorIdLabel).toBe('System Administrator');
      expect(hit.body.data.total).toBeGreaterThanOrEqual(1);

      const miss = await request(app)
        .get('/api/v2/appointments/by-date?date=2026-08-06')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(miss.body.data.items.some((item: { id: string }) => item.id === 'appointment-by-date-http')).toBe(false);

      const invalid = await request(app)
        .get('/api/v2/appointments/by-date?date=abc')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(invalid.body.code).toBe('VALIDATION_ERROR');
    } finally {
      db.prepare("DELETE FROM Appointment WHERE id = 'appointment-by-date-http'").run();
    }
  });

  it('supports member cards, debt, purchase, processing, metrics, and replenishment', async () => {
    const card = await request(app).post('/api/v2/member-cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', cardNo: `HTTP-CARD-${Date.now()}`, status: 'ACTIVE', level: 'NORMAL' })
      .expect(201);
    await request(app).post(`/api/v2/member-cards/${card.body.data.id}/recharge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000, requestId: 'http-card-1' })
      .expect(200);
    await request(app).post(`/api/v2/member-cards/${card.body.data.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, requestId: 'http-card-2' })
      .expect(200);

    await request(app).post('/api/v2/inventory/replenishment/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    await request(app).get('/api/v2/inventory/low-stock').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/metrics').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/stats/revenue?groupBy=month').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/charge-assistant/frequent-items').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('manages users and member cards through explicit admin routes', async () => {
    const user = await request(app).post('/api/v2/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: `HTTP-USER-${Date.now()}`, password: 'password123', name: 'HTTP User', role: 'DOCTOR' })
      .expect(201);
    const userId = user.body.data.id as string;
    await request(app).patch(`/api/v2/admin/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'HTTP Updated', active: false })
      .expect(200);
    await request(app).patch(`/api/v2/admin/users/${userId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'newpassword123' })
      .expect(200);

    const card = await request(app).post('/api/v2/member-cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', cardNo: `HTTP-CARD-ADMIN-${Date.now()}`, status: 'ACTIVE', level: 'VIP' })
      .expect(201);
    expect(card.body.data.balance).toBe(0);
  });

  it('rejects unauthenticated and unknown resources', async () => {
    await request(app).get('/api/v2/resource-meta').expect(401);
    await request(app).get('/api/v2/resources/not-a-resource').set('Authorization', `Bearer ${token}`).expect(404);
    await request(app).get('/api/v2/not-a-route').expect(401);
  });

  it('rotates refresh tokens, logs out, and records audit entries', async () => {
    const login = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'newpass123' }).expect(200);
    const refreshToken = login.body.data.refreshToken as string;
    const refreshed = await request(app).post('/api/v2/auth/refresh').send({ refreshToken }).expect(200);
    expect(refreshed.body.data.token).toBeDefined();
    expect(refreshed.body.data.refreshToken).not.toBe(refreshToken);
    await request(app).post('/api/v2/auth/logout').send({ refreshToken: refreshed.body.data.refreshToken }).expect(200);
    await request(app).post('/api/v2/auth/refresh').send({ refreshToken: refreshed.body.data.refreshToken }).expect(401);

    const before = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    await request(app).post('/api/v2/resources/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'SUP-AUDIT', name: 'Audit Supplier' })
      .expect(201);
    const after = (db.prepare('SELECT COUNT(*) AS c FROM OperationLog').get() as { c: number }).c;
    expect(after).toBeGreaterThan(before);
  });

  it('supports inventory low stock, follow-up reminders, and print templates', async () => {
    await request(app).get('/api/v2/inventory/low-stock').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/follow-ups/reminders').set('Authorization', `Bearer ${token}`).expect(200);
    const followUp = await request(app).post('/api/v2/resources/followUps')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', planDate: '2026-08-04', content: 'complete via http', status: 'PENDING' })
      .expect(201);
    await request(app).patch(`/api/v2/follow-ups/${String(followUp.body.data.id)}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ result: '已回访' })
      .expect(200);
    const secondFollowUp = await request(app).post('/api/v2/resources/followUps')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', planDate: '2026-08-04', content: 'complete without result', status: 'PENDING' })
      .expect(201);
    await request(app).patch(`/api/v2/follow-ups/${String(secondFollowUp.body.data.id)}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    const exportResponse = await request(app)
      .get('/api/v2/follow-ups/reminders/export?scope=overdue')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(exportResponse.headers['content-type']).toContain('text/csv');
    await request(app)
      .get('/api/v2/follow-ups/reminders/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const thirdFollowUp = await request(app).post('/api/v2/resources/followUps')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', planDate: '2026-08-04', content: 'batch complete', status: 'PENDING' })
      .expect(201);
    await request(app)
      .post('/api/v2/follow-ups/batch-complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [thirdFollowUp.body.data.id], result: 'batch done' })
      .expect(200);
    await request(app)
      .post('/api/v2/follow-ups/batch-complete')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    const fourthFollowUp = await request(app).post('/api/v2/resources/followUps')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', planDate: '2026-08-04', content: 'batch complete no result', status: 'PENDING' })
      .expect(201);
    await request(app)
      .post('/api/v2/follow-ups/batch-complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [fourthFollowUp.body.data.id] })
      .expect(200);
    await request(app).get('/api/v2/stats/patient-growth').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/stats/member-cards').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/print/templates').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('returns expiring inventory and masked cross-resource search results', async () => {
    const now = new Date().toISOString();
    const expiringDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, expireDate
       ) VALUES (?, ?, ?, ?, NULL, 'EXP-1', 'Expiring Material', 'CONSUMABLE', 'box', 5, 1, 100, ?)`,
    ).run('inventory-expiring', 'clinic-v2-001', now, now, expiringDate);
    const expiring = await request(app).get('/api/v2/inventory/expiring?days=30')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(expiring.body.data.some((item: { id: string }) => item.id === 'inventory-expiring')).toBe(true);

    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'SEARCH-1', 'Searchable Patient', 'UNKNOWN', '13900001111',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-searchable', 'clinic-v2-001', now, now);
    // 迁移 119 已移除 FTS 触发器（按需重建索引），测试需显式重建。
    rebuildSearchIndex(db);
    const search = await request(app).get('/api/v2/search?q=Searchable')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const patientResult = search.body.data.find((item: { resource: string; id: string }) =>
      item.resource === 'patients' && item.id === 'patient-searchable');
    expect(patientResult).toBeDefined();
    expect(patientResult.detail.phone).toContain('****');
  });

  it('supports clinical workflows and system actions', async () => {
    const registration = await request(app).post('/api/v2/resources/registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', doctorId: 'user-admin-001', type: 'REGULAR', status: 'REGISTERED', registeredAt: new Date().toISOString() })
      .expect(201);
    await request(app).patch(`/api/v2/registrations/${registration.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const visit = await request(app).post('/api/v2/resources/visits')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', doctorId: 'user-admin-001', startTime: new Date().toISOString(), status: 'IN_PROGRESS' })
      .expect(201);
    await request(app).patch(`/api/v2/visits/${visit.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    const exam = await request(app).post('/api/v2/resources/firstExams')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', status: 'DRAFT' })
      .expect(201);
    await request(app).patch(`/api/v2/first-exams/${exam.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUBMITTED' })
      .expect(200);

    const treatment = await request(app).post('/api/v2/resources/treatments')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', doctorId: 'user-admin-001', code: 'T-1', name: 'T', category: 'GENERAL', price: 100, quantity: 1, status: 'PLANNED' })
      .expect(201);
    await request(app).patch(`/api/v2/treatments/${treatment.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const record = await request(app).post('/api/v2/resources/medicalRecords')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', doctorId: 'user-admin-001', status: 'DRAFT' })
      .expect(201);
    await request(app).patch(`/api/v2/medical-records/${record.body.data.id}/lock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ locked: true })
      .expect(200);

    const debtNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge', 'patient-demo-001', 1000, 0, 'UNPAID')`,
    ).run('debt-http', 'clinic-v2-001', debtNow, debtNow);
    await request(app).patch('/api/v2/debts/debt-http/pay')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, requestId: 'http-debt-1' })
      .expect(200);

    await request(app).post('/api/v2/bulk-import/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [{ code: 'HTTP-BULK', name: 'Bulk', gender: 'UNKNOWN', phone: '13500000000', source: 'OTHER' }] })
      .expect(200);

    const notification = await request(app).post('/api/v2/resources/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'user-admin-001', kind: 'system', title: 'T', body: 'B' })
      .expect(201);
    await request(app).get('/api/v2/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).patch(`/api/v2/notifications/${notification.body.data.id}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const alertNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, createdAt, updatedAt, deletedAt,
         level, title, message, source, status
       ) VALUES (?, ?, ?, ?, NULL, 'WARNING', 'T', 'M', 'test', 'OPEN')`,
    ).run('alert-http', 'clinic-v2-001', alertNow, alertNow);
    await request(app).get('/api/v2/system/business-alerts').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).patch('/api/v2/system/business-alerts/alert-http/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACKNOWLEDGED' })
      .expect(200);

    db.prepare(
      `INSERT INTO OperationLog (
         id, userId, action, target, detail, ip, traceId,
         clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, 'user-admin-001', 'OLD_AUDIT', 'old', NULL, NULL, NULL, NULL, ?, ?, NULL)`,
    ).run('audit-http-old', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
    const auditCleanup = await request(app)
      .post('/api/v2/system/audit/cleanup')
      .set('Authorization', `Bearer ${token}`)
      .send({ retentionDays: 365 })
      .expect(200);
    expect(auditCleanup.body.data.deleted).toBeGreaterThanOrEqual(1);

    await request(app).post(`/api/v2/patients/patient-demo-001/risk`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    const ceph = await request(app).post('/api/v2/resources/cephalometricCases')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', imageUrl: 'x.png', landmarksJson: '{"sella":{"x":0,"y":0},"nasion":{"x":10,"y":0}}', status: 'DRAFT' })
      .expect(201);
    await request(app).post(`/api/v2/cephalometric/${ceph.body.data.id}/analyze`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    const plan = await request(app).post('/api/v2/resources/treatmentPlans')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', doctorId: 'user-admin-001', name: 'P', status: 'APPROVED', totalFee: 100 })
      .expect(201);
    await request(app).get(`/api/v2/treatment-plans/${plan.body.data.id}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const prescription = await request(app).post('/api/v2/resources/prescriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'patient-demo-001', doctorId: 'user-admin-001' })
      .expect(201);
    await request(app).get(`/api/v2/prescriptions/${prescription.body.data.id}/safety`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app).post('/api/v2/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'http', deviceToken, changes: [] })
      .expect(200);
  });

  it('rate-limits login attempts per IP with a retry-after header', async () => {
    // 独立 app 实例 = 独立限流器状态：前序用例的登录不会污染本用例计数。
    const isolatedApp = createApp({
      db,
      dbPath,
      backupDir,
      logDir: dataDir,
      logger: new Logger({ logDir: dataDir }),
    });
    let blocked: request.Response | undefined;
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const response = await request(isolatedApp)
        .post('/api/v2/auth/login')
        .send({ username: `ip-flood-${i}`, password: 'wrong-password' });
      lastStatus = response.status;
      if (response.status === 429) blocked = response;
    }
    expect(blocked).toBeDefined();
    expect(lastStatus).toBe(429);
    expect(blocked!.headers['retry-after']).toBeDefined();
  });

  it('audits successful logins with user identity', async () => {
    const username = 'audit-login-ok';
    await request(app)
      .post('/api/v2/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username, password: 'password123', name: 'Audit Login Ok', role: 'RECEPTIONIST' })
      .expect(201);
    const response = await request(app)
      .post('/api/v2/auth/login')
      .send({ username, password: 'password123' })
      .expect(200);
    const row = db.prepare(
      `SELECT userId, userName, target, traceId FROM OperationLog
       WHERE action = 'LOGIN_SUCCESS' AND target = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1`,
    ).get(username) as { userId: string; userName: string; target: string; traceId: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.userId).toBe(response.body.data.user.id);
    expect(row!.userName).toBe(username);
    expect(row!.target).toBe(username);
    expect(row!.traceId).toBe(response.headers['x-request-id']);
  });

  it('audits failed logins with the error detail', async () => {
    const username = 'audit-login-fail';
    const response = await request(app)
      .post('/api/v2/auth/login')
      .send({ username, password: 'wrong-password' })
      .expect(401);
    const rows = db.prepare(
      `SELECT target, detail, traceId FROM OperationLog WHERE action = 'LOGIN_FAILED' AND traceId = ?`,
    ).all(response.body.traceId as string) as Array<{ target: string; detail: string | null; traceId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe(username);
    expect(rows[0].detail).toBe('Invalid username or password');
  });

  it('does not duplicate audit entries for rate-limited logins', async () => {
    // 429 在限流器层短路（handler 之外），不得产生第二条 LOGIN_FAILED；
    // 穿过限流器的 401 每次恰好一条 LOGIN_FAILED。
    let blocked: request.Response | undefined;
    const passed: request.Response[] = [];
    for (let i = 0; i < 11; i += 1) {
      const response = await request(app)
        .post('/api/v2/auth/login')
        .send({ username: `audit-flood-${i}`, password: 'wrong-password' });
      if (response.status === 429) {
        blocked = response;
        break;
      }
      passed.push(response);
    }
    expect(blocked).toBeDefined();
    for (const response of passed) {
      const rows = db.prepare('SELECT action FROM OperationLog WHERE traceId = ?').all(response.body.traceId as string) as Array<{ action: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('LOGIN_FAILED');
    }
    const blockedRows = db.prepare('SELECT COUNT(*) AS c FROM OperationLog WHERE traceId = ?').get(blocked!.body.traceId as string) as { c: number };
    expect(blockedRows.c).toBe(0);
  });

  // ── T4.10 M6-edge: 审计 flush 重试与关闭冲刷 ────────────────────────────────
  // pushAudit 在 NODE_ENV=test 下直写 db、不经过缓冲，因此以下用例临时切换到
  // 'production'（try/finally 恢复）；insertAuditStmt 在 createApp 时一次性
  // prepare，要模拟 flush 失败必须在 createApp 之前包装 db.prepare，故每个用例
  // 使用独立的临时 db + 独立 app，避免影响 beforeAll 的共享 app。
  function wrapOperationLogInsertFailures(localDb: Database.Database, mode: 'once' | 'always'): () => number {
    let runCalls = 0;
    const originalPrepare = localDb.prepare.bind(localDb);
    localDb.prepare = ((source: string) => {
      const statement = originalPrepare(source);
      if (source.includes('INSERT INTO OperationLog')) {
        const originalRun = statement.run.bind(statement);
        statement.run = ((...args: unknown[]) => {
          runCalls += 1;
          if (mode === 'always' || runCalls === 1) {
            throw new Error('simulated audit flush failure');
          }
          return originalRun(...args);
        }) as typeof statement.run;
      }
      return statement;
    }) as typeof localDb.prepare;
    return () => runCalls;
  }

  function createIsolatedAuditApp(failMode?: 'once' | 'always'): {
    app: ReturnType<typeof createApp>;
    db: Database.Database;
    dataDir: string;
    runCalls: () => number;
  } {
    const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-audit-'));
    const isolatedDbPath = path.join(isolatedDataDir, 'v2.sqlite');
    const isolatedDb = createDatabase(isolatedDataDir, isolatedDbPath);
    // seedDatabase 在 NODE_ENV=production 下拒绝播种默认凭据；用例需要在
    // production 下测 pushAudit 缓冲路径，故播种/迁移临时回到 test 再恢复。
    const seedingNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      seedDatabase(isolatedDb);
      runMigrations(isolatedDb);
    } finally {
      if (seedingNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = seedingNodeEnv;
    }
    const runCalls = failMode === undefined ? () => 0 : wrapOperationLogInsertFailures(isolatedDb, failMode);
    const isolatedApp = createApp({
      db: isolatedDb,
      dbPath: isolatedDbPath,
      backupDir: path.join(isolatedDataDir, 'backups'),
      logDir: isolatedDataDir,
      logger: new Logger({ logDir: isolatedDataDir }),
    });
    return { app: isolatedApp, db: isolatedDb, dataDir: isolatedDataDir, runCalls };
  }

  function restoreNodeEnv(previousNodeEnv: string | undefined): void {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }

  it('exposes flushAuditNow and drains the production audit buffer on demand', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    vi.useFakeTimers();
    let isolated: ReturnType<typeof createIsolatedAuditApp> | undefined;
    try {
      process.env.NODE_ENV = 'production';
      isolated = createIsolatedAuditApp();
      const flushAuditNow = isolated.app.locals.flushAuditNow as (() => void) | undefined;
      expect(typeof flushAuditNow).toBe('function');
      const audit = isolated.app.locals.audit as (input: AuditInput) => void;
      audit({ userId: 'u-audit-drain', action: 'drain-0', statusCode: 200 });
      audit({ userId: 'u-audit-drain', action: 'drain-1', statusCode: 200 });
      audit({ userId: 'u-audit-drain', action: 'drain-2', statusCode: 200 });
      flushAuditNow!();
      const rows = isolated.db.prepare(
        "SELECT action FROM OperationLog WHERE userId = 'u-audit-drain' ORDER BY action",
      ).all() as Array<{ action: string }>;
      expect(rows.map((row) => row.action)).toEqual(['drain-0', 'drain-1', 'drain-2']);
      // 缓冲空时重复调用是 no-op，不抛错
      expect(() => flushAuditNow!()).not.toThrow();
      // flushAuditNow 不是一次性：再次入缓冲的行仍可被冲刷
      audit({ userId: 'u-audit-drain', action: 'drain-3', statusCode: 200 });
      flushAuditNow!();
      expect((isolated.db.prepare(
        "SELECT COUNT(*) AS c FROM OperationLog WHERE userId = 'u-audit-drain'",
      ).get() as { c: number }).c).toBe(4);
    } finally {
      restoreNodeEnv(previousNodeEnv);
      vi.useRealTimers();
      if (isolated) {
        isolated.db.close();
        fs.rmSync(isolated.dataDir, { recursive: true, force: true });
      }
    }
  });

  it('retries a failed audit flush exactly once and persists the batch on retry', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    vi.useFakeTimers();
    let isolated: ReturnType<typeof createIsolatedAuditApp> | undefined;
    try {
      process.env.NODE_ENV = 'production';
      isolated = createIsolatedAuditApp('once');
      const audit = isolated.app.locals.audit as (input: AuditInput) => void;
      audit({ userId: 'u-audit-retry', action: 'retry-once', statusCode: 200 });
      expect(isolated.runCalls()).toBe(0); // < MAX：只入缓冲并调度定时器，尚未 run
      await vi.advanceTimersByTimeAsync(1000); // 定时器 flush：首次 run 抛错 → 失败行放回队首并调度重试
      expect(isolated.runCalls()).toBe(1);
      expect((isolated.db.prepare(
        "SELECT COUNT(*) AS c FROM OperationLog WHERE action = 'retry-once'",
      ).get() as { c: number }).c).toBe(0);
      await vi.advanceTimersByTimeAsync(1000); // 重试成功：恰好第 2 次 run
      expect(isolated.runCalls()).toBe(2);
      const rows = isolated.db.prepare(
        "SELECT action FROM OperationLog WHERE action = 'retry-once'",
      ).all() as Array<{ action: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('retry-once');
      await vi.advanceTimersByTimeAsync(10_000); // 不再调度更多重试
      expect(isolated.runCalls()).toBe(2);
      expect((isolated.db.prepare(
        "SELECT COUNT(*) AS c FROM OperationLog WHERE action = 'retry-once'",
      ).get() as { c: number }).c).toBe(1);
    } finally {
      restoreNodeEnv(previousNodeEnv);
      vi.useRealTimers();
      if (isolated) {
        isolated.db.close();
        fs.rmSync(isolated.dataDir, { recursive: true, force: true });
      }
    }
  });

  it('does not lose a full buffer when the immediate flush fails and retries stay bounded', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    vi.useFakeTimers();
    let isolated: ReturnType<typeof createIsolatedAuditApp> | undefined;
    try {
      process.env.NODE_ENV = 'production';
      isolated = createIsolatedAuditApp('once');
      const audit = isolated.app.locals.audit as (input: AuditInput) => void;
      for (let i = 0; i < 50; i += 1) { // AUDIT_BUFFER_MAX
        audit({ userId: 'u-audit-max', action: `max-${i}`, statusCode: 200 });
      }
      expect(isolated.runCalls()).toBe(1); // 第 50 条触发立即 flush：首次 run 抛错，该批被事务回滚后入队重试
      await vi.advanceTimersByTimeAsync(1000); // 定时器 flush（先于重试定时器注册）把 50 行刷入
      expect(isolated.runCalls()).toBe(51); // 1 败 + 50 成
      const rows = isolated.db.prepare(
        "SELECT action FROM OperationLog WHERE userId = 'u-audit-max'",
      ).all() as Array<{ action: string }>;
      expect(rows).toHaveLength(50); // 全部落库、无重复行
      expect(new Set(rows.map((row) => row.action)).size).toBe(50);
      await vi.advanceTimersByTimeAsync(10_000); // 不再有更多 flush 尝试
      expect(isolated.runCalls()).toBe(51);
      expect((isolated.db.prepare(
        "SELECT COUNT(*) AS c FROM OperationLog WHERE userId = 'u-audit-max'",
      ).get() as { c: number }).c).toBe(50);
    } finally {
      restoreNodeEnv(previousNodeEnv);
      vi.useRealTimers();
      if (isolated) {
        isolated.db.close();
        fs.rmSync(isolated.dataDir, { recursive: true, force: true });
      }
    }
  });

  it('stops after one retry when the flush keeps failing (no infinite loop)', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    vi.useFakeTimers();
    let isolated: ReturnType<typeof createIsolatedAuditApp> | undefined;
    try {
      process.env.NODE_ENV = 'production';
      isolated = createIsolatedAuditApp('always');
      const audit = isolated.app.locals.audit as (input: AuditInput) => void;
      audit({ userId: 'u-audit-always', action: 'never-persisted', statusCode: 200 });
      expect(isolated.runCalls()).toBe(0);
      await vi.advanceTimersByTimeAsync(1000); // 首次 flush 失败 → 入队重试
      expect(isolated.runCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000); // 重试也失败 → 只记日志，不再入队
      expect(isolated.runCalls()).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000); // 长时间推进不再产生新调用（有界）
      expect(isolated.runCalls()).toBe(2);
      expect((isolated.db.prepare(
        "SELECT COUNT(*) AS c FROM OperationLog WHERE action = 'never-persisted'",
      ).get() as { c: number }).c).toBe(0);
    } finally {
      restoreNodeEnv(previousNodeEnv);
      vi.useRealTimers();
      if (isolated) {
        isolated.db.close();
        fs.rmSync(isolated.dataDir, { recursive: true, force: true });
      }
    }
  });
});
