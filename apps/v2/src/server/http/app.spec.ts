import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
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
});
