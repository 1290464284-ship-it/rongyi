import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { rebuildSearchIndex } from '../infrastructure/search-index';
import { Logger } from '../infrastructure/logger';

describe('resource router', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let receptionToken: string;
  const now = new Date().toISOString();

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-router-'));
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
    const admin = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200);
    adminToken = admin.body.data.token as string;

    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'receptionist', ?, 'Reception', 'RECEPTIONIST', 1, 0, 0)`,
    ).run('user-router-reception', 'clinic-v2-001', now, now, bcrypt.hashSync('reception123', 10));
    const reception = await request(app).post('/api/v2/auth/login')
      .send({ username: 'receptionist', password: 'reception123' })
      .expect(200);
    receptionToken = reception.body.data.token as string;
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('covers list filters, sort, pagination, create, get, update, and delete', async () => {
    const created = await request(app)
      .post('/api/v2/resources/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'ROUTER-001',
        name: 'Router Patient',
        gender: 'UNKNOWN',
        phone: '13611110000',
        source: 'WALK_IN',
        active: true,
      })
      .expect(201);
    const id = created.body.data.id as string;

    // 资源列表 search 已走 FTS；迁移 119 移除触发器后需显式重建索引（运行时插入的行不会自动入索引）。
    rebuildSearchIndex(db);
    const list = await request(app)
      .get('/api/v2/resources/patients?page=1&pageSize=5&search=Router&sortBy=name&sortOrder=ASC&active=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.items.some((item: { id: string }) => item.id === id)).toBe(true);

    const byId = await request(app)
      .get(`/api/v2/resources/patients/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byId.body.data.id).toBe(id);

    const exported = await request(app)
      .get('/api/v2/resources/patients/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain('"ID"');
    expect(exported.text).toContain('Router Patient');
    const emptyExport = await request(app)
      .get('/api/v2/resources/patients/export?name=DoesNotExist')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(emptyExport.text).toBe('\uFEFF');
    await request(app)
      .get('/api/v2/resources/patients/export?unknown=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    await request(app)
      .patch(`/api/v2/resources/patients/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Router Renamed' })
      .expect(200);

    await request(app)
      .delete(`/api/v2/resources/patients/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const deleted = await request(app)
      .get(`/api/v2/resources/patients/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(deleted.body.code).toBe('NOT_FOUND');
    await request(app)
      .delete('/api/v2/resources/patients/missing-router-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('exports more than one page of rows', async () => {
    for (let index = 0; index < 201; index += 1) {
      await request(app)
        .post('/api/v2/resources/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `EXPORT-${index}`,
          name: 'Export Row',
          gender: 'UNKNOWN',
          phone: `13900000${String(index).padStart(4, '0')}`,
          source: 'OTHER',
          active: true,
        })
        .expect(201);
    }
    const exported = await request(app)
      .get('/api/v2/resources/patients/export?name=Export Row')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(exported.text.match(/"Export Row"/g)?.length).toBe(201);
  });

  it('prefixes formula-injecting CSV cells with a single quote', async () => {
    await request(app)
      .post('/api/v2/resources/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'CSV-FORMULA',
        name: '=HYPERLINK("https://evil.example","x")',
        gender: 'UNKNOWN',
        phone: '+8613800000000',
        address: '-1+1',
        source: 'WALK_IN',
        active: true,
      })
      .expect(201);
    const exported = await request(app)
      .get('/api/v2/resources/patients/export?code=CSV-FORMULA')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // 公式注入前缀（=、- 等）必须被单引号防护；phone 属敏感字段，导出路径已掩码为空（security.spec 覆盖）。
    expect(exported.text).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
    expect(exported.text).toContain(`"'-1+1"`);
  });

  it('keeps resource lists and CSV export scoped to the active clinic', async () => {
    const otherClinic = 'clinic-v2-export-other';
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-EXPORT-OTHER', 'Export Other Clinic', 1)`,
    ).run(otherClinic, now, now);
    const admin = db.prepare("SELECT id FROM User WHERE username = 'admin'").get() as { id: string };
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, 'BOSS', ?, ?, NULL)`,
    ).run(admin.id, otherClinic, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EXPORT-OTHER', 'Other Clinic Secret', 'UNKNOWN', '13900009999',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-export-other', otherClinic, now, now);

    // 资源列表 search 已走 FTS；迁移 119 移除触发器后需显式重建索引（直接 SQL 插入不会自动入索引）。
    rebuildSearchIndex(db);
    const switched = await request(app)
      .post('/api/v2/auth/switch-clinic')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clinicId: otherClinic })
      .expect(200);
    const otherToken = switched.body.data.token as string;

    const list = await request(app)
      .get('/api/v2/resources/patients?search=Other%20Clinic%20Secret')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0].id).toBe('patient-export-other');

    const originalList = await request(app)
      .get('/api/v2/resources/patients?search=Router%20Patient')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(originalList.body.data.total).toBe(0);

    const exported = await request(app)
      .get('/api/v2/resources/patients/export?name=Other%20Clinic%20Secret')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(exported.text).toContain('Other Clinic Secret');
    expect(exported.text).not.toContain('Router Patient');
  });

  it('covers missing request bodies for generic create and patch', async () => {
    const created = await request(app)
      .post('/api/v2/resources/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'ROUTER-NOBODY',
        name: 'No Body Patient',
        gender: 'UNKNOWN',
        phone: '13611110001',
        source: 'WALK_IN',
        active: true,
      })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app)
      .post('/api/v2/resources/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const patch = await request(app)
      .patch(`/api/v2/resources/patients/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(patch.body.data.id).toBe(id);
  });

  it('covers array filters and unsupported resource capabilities', async () => {
    await request(app)
      .get('/api/v2/resources/patients?tags=a&tags=b')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .post('/api/v2/resources/operationLogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'x' })
      .expect(404);
    await request(app)
      .patch('/api/v2/resources/operationLogs/log-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'x' })
      .expect(404);
    await request(app)
      .delete('/api/v2/resources/operationLogs/log-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('covers forbidden roles and validation errors', async () => {
    const forbidden = await request(app)
      .get('/api/v2/resources/operationLogs')
      .set('Authorization', `Bearer ${receptionToken}`)
      .expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const invalid = await request(app)
      .post('/api/v2/resources/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Missing required fields' })
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('removes legacy table routes and blocks bulk import privilege escalation', async () => {
    const meta = await request(app)
      .get('/api/v2/resource-meta')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(meta.body.data.some((item: { name: string }) => item.name === 'User')).toBe(false);

    const legacy = await request(app)
      .get('/api/v2/resources/User')
      .set('Authorization', `Bearer ${receptionToken}`)
      .expect(404);
    expect(legacy.body.code).toBe('NOT_FOUND');

    const bulkEscalation = await request(app)
      .post('/api/v2/bulk-import/users')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ rows: [{ username: 'x', name: 'x', role: 'BOSS' }] })
      .expect(403);
    expect(bulkEscalation.body.code).toBe('FORBIDDEN');

    const adminBulk = await request(app)
      .post('/api/v2/bulk-import/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rows: [{ username: 'x', name: 'x', role: 'BOSS' }] })
      .expect(403);
    expect(adminBulk.body.code).toBe('FORBIDDEN');

    await request(app)
      .post('/api/v2/backups')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({})
      .expect(403);
  });

  it('rejects invalid pagination with 400 and caps oversized pageSize at 200', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    for (const qs of ['page=abc', 'page=0', 'page=-1', 'page=1.5', 'pageSize=abc', 'pageSize=0', 'pageSize=-5', 'page=abc&pageSize=abc']) {
      await request(app).get(`/api/v2/resources/patients?${qs}`).set(auth).expect(400);
    }
    const capped = await request(app).get('/api/v2/resources/patients?pageSize=999999').set(auth).expect(200);
    expect(capped.body.data.pageSize).toBe(200);
    await request(app).get('/api/v2/resources/patients?page=&pageSize=').set(auth).expect(200);
  });
});
