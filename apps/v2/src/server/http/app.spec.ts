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
    const login = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'REDACTED' });
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
    const deep = await request(app).get('/api/v2/health/deep').expect(200);
    expect(deep.body.data.database).toBe('ok');
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
      .expect(200);

    const purchase = await request(app)
      .post('/api/v2/resources/purchaseOrders')
      .set('Authorization', `Bearer ${token}`)
      .send({ number: 'PO-HTTP', supplierId: 'supplier-http', totalAmount: 0, status: 'PENDING' })
      .expect(201);
    await request(app)
      .patch(`/api/v2/purchase-orders/${purchase.body.data.id}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
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
      .send({ oldPassword: 'REDACTED', newPassword: 'newpass123' })
      .expect(200);
    const relogin = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'newpass123' }).expect(200);
    token = relogin.body.data.token;
    const patients = await request(app).get('/api/v2/resources/patients?search=HTTP')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patients.body.data.items.length).toBeGreaterThanOrEqual(1);
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
    await request(app).get('/api/v2/analytics/rfm').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/analytics/churn').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/analytics/doctor-anomalies').set('Authorization', `Bearer ${token}`).expect(200);
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
    const card = await request(app).post('/api/v2/resources/memberCards')
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

  it('supports inventory low stock, follow-up reminders, doctor stats, and print templates', async () => {
    await request(app).get('/api/v2/inventory/low-stock').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/follow-ups/reminders').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v2/stats/doctor-workload').set('Authorization', `Bearer ${token}`).expect(200);
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
    ).run('inventory-expiring', null, now, now, expiringDate);
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
    ).run('patient-searchable', null, now, now);
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

    const debt = await request(app).post('/api/v2/resources/debtRecords')
      .set('Authorization', `Bearer ${token}`)
      .send({ chargeId: 'charge', patientId: 'patient-demo-001', totalAmount: 1000, paidAmount: 0, status: 'UNPAID' })
      .expect(201);
    await request(app).patch(`/api/v2/debts/${debt.body.data.id}/pay`)
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

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, createdAt, updatedAt, deletedAt,
         level, title, message, source, status
       ) VALUES (?, ?, ?, ?, NULL, 'WARNING', 'T', 'M', 'test', 'OPEN')`,
    ).run('alert-http', null, now, now);
    await request(app).get('/api/v2/system/business-alerts').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).patch('/api/v2/system/business-alerts/alert-http/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACKNOWLEDGED' })
      .expect(200);

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
