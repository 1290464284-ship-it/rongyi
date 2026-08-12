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

interface RouteCase {
  method: 'get' | 'post' | 'patch';
  path: string;
  body?: Record<string, unknown>;
}

const errorCases: RouteCase[] = [
  { method: 'get', path: '/api/v2/health/deep' },
  { method: 'post', path: '/api/v2/auth/login', body: { username: 'admin', password: 'wrong' } },
  { method: 'post', path: '/api/v2/auth/refresh', body: { refreshToken: 'bad-refresh-token' } },
  { method: 'post', path: '/api/v2/auth/logout', body: { refreshToken: 'bad-refresh-token' } },
  { method: 'get', path: '/api/v2/auth/me' },
  { method: 'patch', path: '/api/v2/auth/password', body: { oldPassword: 'wrong', newPassword: 'newpass123' } },
  {
    method: 'post',
    path: '/api/v2/appointments',
    body: {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      startTime: '2026-08-04T00:00:00.000Z',
      endTime: '2026-08-03T00:00:00.000Z',
      type: 'REGULAR',
    },
  },
  { method: 'patch', path: '/api/v2/appointments/not-found/status', body: { status: 'CANCELLED' } },
  { method: 'patch', path: '/api/v2/registrations/not-found/status', body: { status: 'IN_PROGRESS' } },
  { method: 'patch', path: '/api/v2/visits/not-found/status', body: { status: 'COMPLETED' } },
  { method: 'patch', path: '/api/v2/first-exams/not-found/status', body: { status: 'SUBMITTED' } },
  { method: 'patch', path: '/api/v2/treatments/not-found/status', body: { status: 'IN_PROGRESS' } },
  { method: 'patch', path: '/api/v2/medical-records/not-found/lock', body: { locked: true } },
  { method: 'post', path: '/api/v2/inventory/replenishment/generate', body: {} },
  { method: 'post', path: '/api/v2/inventory/replenishment/apply', body: { ids: [] } },
  { method: 'post', path: '/api/v2/wechat/not-found/send', body: {} },
  { method: 'post', path: '/api/v2/wechat/send-batch', body: { ids: ['not-found'] } },
  { method: 'get', path: '/api/v2/analytics/rfm' },
  { method: 'get', path: '/api/v2/analytics/churn' },
  { method: 'get', path: '/api/v2/analytics/doctor-anomalies' },
  { method: 'get', path: '/api/v2/charge-assistant/frequent-items' },
  { method: 'get', path: '/api/v2/print/templates' },
  { method: 'post', path: '/api/v2/print/templates/not-found/render', body: { title: 'x' } },
  { method: 'post', path: '/api/v2/charges', body: { patientId: 'patient-demo-001', items: [] } },
  { method: 'patch', path: '/api/v2/charges/not-found/pay', body: { amount: 1, method: 'CASH' } },
  { method: 'post', path: '/api/v2/charges/not-found/refund', body: { amount: 1, reason: 'x' } },
  { method: 'post', path: '/api/v2/member-cards/not-found/recharge', body: { amount: 1 } },
  { method: 'post', path: '/api/v2/member-cards/not-found/consume', body: { amount: 1 } },
  { method: 'post', path: '/api/v2/member-cards/not-found/points', body: { points: 1 } },
  { method: 'patch', path: '/api/v2/purchase-orders/not-found/receive', body: {} },
  { method: 'get', path: '/api/v2/purchase-orders/not-found/items' },
  { method: 'patch', path: '/api/v2/processing-orders/not-found/status', body: { status: 'SENT' } },
  { method: 'post', path: '/api/v2/patients/not-found/risk', body: {} },
  { method: 'get', path: '/api/v2/prescriptions/not-found/safety' },
  { method: 'post', path: '/api/v2/cephalometric/not-found/analyze', body: {} },
  { method: 'get', path: '/api/v2/treatment-plans/not-found/progress' },
  { method: 'post', path: '/api/v2/bulk-import/not-a-resource', body: { rows: [] } },
  { method: 'patch', path: '/api/v2/debts/not-found/pay', body: { amount: 1 } },
  { method: 'get', path: '/api/v2/notifications' },
  { method: 'patch', path: '/api/v2/notifications/not-found/read', body: {} },
  { method: 'get', path: '/api/v2/satisfaction/nps' },
  { method: 'get', path: '/api/v2/satisfaction/trend' },
  { method: 'get', path: '/api/v2/satisfaction/doctor-rankings' },
  { method: 'post', path: '/api/v2/inventory/transactions', body: { itemId: 'not-found', type: 'OUT', quantity: 1 } },
  { method: 'get', path: '/api/v2/inventory/low-stock' },
  { method: 'get', path: '/api/v2/inventory/expiring?days=30' },
  { method: 'get', path: '/api/v2/follow-ups/reminders' },
  { method: 'get', path: '/api/v2/follow-ups/reminders/summary' },
  { method: 'get', path: '/api/v2/follow-ups/reminders/export?scope=bad' },
  { method: 'post', path: '/api/v2/follow-ups/batch-complete', body: { ids: [] } },
  { method: 'patch', path: '/api/v2/follow-ups/not-found/complete', body: {} },
  { method: 'get', path: '/api/v2/follow-ups/adherence' },
  { method: 'post', path: '/api/v2/follow-ups/batch-generate', body: { limit: 1 } },
  { method: 'get', path: '/api/v2/stats/dashboard' },
  { method: 'get', path: '/api/v2/stats/revenue?startDate=not-a-date' },
  { method: 'get', path: '/api/v2/stats/patient-growth?startDate=not-a-date' },
  { method: 'get', path: '/api/v2/stats/inventory' },
  { method: 'get', path: '/api/v2/stats/member-cards' },
  { method: 'get', path: '/api/v2/print?kind=report&data=%7B%22title%22%3A' },
  { method: 'post', path: '/api/v2/print', body: { kind: 'report', data: 'not-an-object' } },
  { method: 'post', path: '/api/v2/sync/cleanup', body: {} },
  { method: 'get', path: '/api/v2/hr/attendance' },
  { method: 'patch', path: '/api/v2/hr/leaves/not-found/approve', body: { approved: true } },
  { method: 'get', path: '/api/v2/system/business-alerts' },
  { method: 'patch', path: '/api/v2/system/business-alerts/not-found/status', body: { status: 'ACKNOWLEDGED' } },
  { method: 'get', path: '/api/v2/backups' },
  { method: 'post', path: '/api/v2/backups', body: {} },
  { method: 'post', path: '/api/v2/backups/cleanup', body: { maxKeep: 30 } },
  { method: 'post', path: '/api/v2/backups/cleanup', body: { maxKeep: 0 } },
  { method: 'post', path: '/api/v2/backups/not-found/restore', body: {} },
  { method: 'get', path: '/api/v2/backups/not-found/verify' },
  { method: 'get', path: '/api/v2/search?q=ab' },
  { method: 'get', path: '/api/v2/not-a-route' },
];

describe('HTTP app edge error handling', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let refreshToken: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-app-edge-'));
    process.env.V2_CORS_ORIGIN = 'https://trusted.example';
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
    const login = await request(app).post('/api/v2/auth/login').send({ username: 'admin', password: 'v2-test-seed-password' }).expect(200);
    token = login.body.data.token as string;
    refreshToken = login.body.data.refreshToken as string;
    fs.mkdirSync(path.join(dataDir, 'metrics.json'));
    const backupDir = path.join(dataDir, 'backups');
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.writeFileSync(backupDir, 'not a directory');
  });

  afterAll(() => {
    delete process.env.V2_CORS_ORIGIN;
    if (db.open) db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists BOSS clinics and switches the current clinic', async () => {
    const clinics = await request(app)
      .get('/api/v2/auth/clinics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(clinics.body.data.clinics.length).toBeGreaterThanOrEqual(1);
    const switched = await request(app)
      .post('/api/v2/auth/switch-clinic')
      .set('Authorization', `Bearer ${token}`)
      .send({ clinicId: 'clinic-v2-001' })
      .expect(200);
    expect(switched.body.data.clinicId).toBe('clinic-v2-001');
    const auditRow = db.prepare(
      "SELECT * FROM OperationLog WHERE action = 'auth.switch-clinic' ORDER BY createdAt DESC LIMIT 1",
    ).get() as Record<string, unknown>;
    expect(auditRow.target).toBe('clinic-v2-001');
    expect(JSON.parse(String(auditRow.detail))).toEqual({ from: 'clinic-v2-001', to: 'clinic-v2-001' });
    expect(auditRow.clinicId).toBe('clinic-v2-001');
    await request(app)
      .post('/api/v2/auth/switch-clinic')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(404);
  });

  it('prevents generic resource writes from bypassing state machines', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
    const created = await auth(request(app).post('/api/v2/resources/appointments')).send({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      startTime: '2026-08-10T02:00:00.000Z',
      endTime: '2026-08-10T03:00:00.000Z',
      type: 'REGULAR',
      status: 'COMPLETED',
    }).expect(201);
    const appointmentId = created.body.data.id as string;
    expect((db.prepare('SELECT status FROM Appointment WHERE id = ?').get(appointmentId) as { status: string }).status).toBe('BOOKED');
    await auth(request(app).patch(`/api/v2/resources/appointments/${appointmentId}`))
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect((db.prepare('SELECT status FROM Appointment WHERE id = ?').get(appointmentId) as { status: string }).status).toBe('BOOKED');

    const rx = await auth(request(app).post('/api/v2/resources/prescriptions')).send({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'PROCESSED',
      chargeId: 'fake-charge',
    }).expect(201);
    const rxRow = db.prepare('SELECT status, chargeId FROM Prescription WHERE id = ?').get(rx.body.data.id as string) as {
      status: string;
      chargeId: string | null;
    };
    expect(rxRow.status).toBe('DRAFT');
    expect(rxRow.chargeId).toBeNull();

    const registration = await auth(request(app).post('/api/v2/resources/registrations')).send({
      patientId: 'patient-demo-001',
      type: 'REGULAR',
      registeredAt: new Date().toISOString(),
      status: 'COMPLETED',
    }).expect(201);
    expect((db.prepare('SELECT status FROM Registration WHERE id = ?').get(registration.body.data.id as string) as { status: string }).status)
      .toBe('REGISTERED');

    const followUp = await auth(request(app).post('/api/v2/resources/followUps')).send({
      patientId: 'patient-demo-001',
      planDate: '2026-08-05',
      content: 'state machine reset',
      status: 'COMPLETED',
      executionStatus: 'DONE',
    }).expect(201);
    const followUpRow = db.prepare('SELECT status, executionStatus FROM FollowUp WHERE id = ?')
      .get(followUp.body.data.id as string) as { status: string; executionStatus: string };
    expect(followUpRow.status).toBe('PENDING');
    expect(followUpRow.executionStatus).toBe('PENDING');
  });

  it('rejects non-boolean medical record lock payloads', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
    const created = await auth(request(app).post('/api/v2/resources/medicalRecords')).send({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'DRAFT',
    }).expect(201);
    const response = await auth(request(app).patch(`/api/v2/medical-records/${created.body.data.id as string}/lock`))
      .send({ locked: 'yes' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('protects medical records, leave requests, and business alerts from generic state writes', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
    const medical = await auth(request(app).post('/api/v2/resources/medicalRecords')).send({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'DRAFT',
    }).expect(201);
    const medicalId = medical.body.data.id as string;
    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE MedicalRecord SET isLocked = 1, editRequestStatus = 'NONE', updatedAt = ? WHERE id = ?`,
    ).run(nowIso, medicalId);
    await auth(request(app).patch(`/api/v2/resources/medicalRecords/${medicalId}`))
      .send({ isLocked: false, editRequestStatus: 'APPROVED' })
      .expect(200);
    const lockedRow = db.prepare('SELECT isLocked, editRequestStatus FROM MedicalRecord WHERE id = ?').get(medicalId) as {
      isLocked: number; editRequestStatus: string;
    };
    expect(lockedRow.isLocked).toBe(1);
    expect(lockedRow.editRequestStatus).toBe('NONE');
    await auth(request(app).delete(`/api/v2/resources/medicalRecords/${medicalId}`)).expect(403);

    const leave = await auth(request(app).post('/api/v2/resources/leaveRequests')).send({
      userId: 'user-admin-001',
      startDate: '2026-08-20',
      endDate: '2026-08-21',
      type: 'ANNUAL',
      reason: 'generic create',
      status: 'APPROVED',
    }).expect(201);
    expect((db.prepare('SELECT status FROM LeaveRequest WHERE id = ?').get(leave.body.data.id as string) as { status: string }).status)
      .toBe('PENDING');

    db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, createdAt, updatedAt, deletedAt,
         alertType, level, severity, title, message, source, status, acknowledged
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'OPEN', 0)`,
    ).run('alert-generic-guard', 'clinic-v2-001', nowIso, nowIso, 'BATCH_EXPIRY', 'WARNING', 'WARN', 'A', 'M', 'TEST');
    await auth(request(app).patch('/api/v2/resources/businessAlerts/alert-generic-guard'))
      .send({ status: 'RESOLVED', acknowledged: true })
      .expect(200);
    const alertRow = db.prepare('SELECT status, acknowledged FROM BusinessAlert WHERE id = ?').get('alert-generic-guard') as {
      status: string; acknowledged: number;
    };
    expect(alertRow.status).toBe('OPEN');
    expect(alertRow.acknowledged).toBe(0);
  });

  it('replays bulk import with the same requestId without duplicate writes', async () => {
    const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
    const payload = {
      requestId: 'bulk-replay-1',
      rows: [{ code: 'BULK-REPLAY', name: 'Bulk Replay', gender: 'UNKNOWN', phone: '13500000009', source: 'OTHER' }],
    };
    const first = await auth(request(app).post('/api/v2/bulk-import/patients')).send(payload).expect(200);
    const second = await auth(request(app).post('/api/v2/bulk-import/patients')).send(payload).expect(200);
    expect(second.body.data.imported).toBe(first.body.data.imported);
    const count = db.prepare('SELECT COUNT(*) AS c FROM Patient WHERE code = ?').get('BULK-REPLAY') as { c: number };
    expect(Number(count.c)).toBe(1);
  });

  it('short search terms and unknown routes return safe local responses', async () => {
    const short = await request(app)
      .get('/api/v2/search?q=a')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(short.body.data).toEqual([]);

    const missing = await request(app)
      .get('/api/v2/not-a-route')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(missing.body.code).toBe('FORBIDDEN');
    db.close();
  });

  it('routes closed-database and invalid-input errors through the app error middleware', async () => {
    for (const routeCase of errorCases) {
      let req = request(app)[routeCase.method](routeCase.path);
      if (routeCase.body) req = req.send(routeCase.body);
      const response = await req.set('Authorization', `Bearer ${token}`);
      expect(response.status, `${routeCase.method.toUpperCase()} ${routeCase.path}`).toBeGreaterThanOrEqual(400);
    }
  }, 10_000);

  it('routes logout errors through the app error middleware', async () => {
    const response = await request(app)
      .post('/api/v2/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ refreshToken });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('enforces the CORS localhost and configured-origin whitelist', async () => {
    // 收紧后仅放行 API 端口（默认 3180）与 Vite dev 端口（5180），任意 loopback 端口不再放行。
    const allowed = ['https://trusted.example', 'http://localhost:3180', 'http://127.0.0.1:3180'];
    for (const origin of allowed) {
      const response = await request(app)
        .get('/api/v2/health')
        .set('Origin', origin);
      expect(response.status, origin).toBe(200);
    }
    for (const origin of ['https://evil.example', 'http://[invalid']) {
      const response = await request(app)
        .get('/api/v2/health')
        .set('Origin', origin);
      expect(response.status, origin).toBeGreaterThanOrEqual(400);
    }
  });

});
