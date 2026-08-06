import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerRefundFlowRoutes } from './refund-flow-routes';

describe('refund flow routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-refund-flow-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerRefundFlowRoutes(app, db);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const insertCharge = (
      id: string,
      overrides: { refundedAmount: number; status: string },
    ): void => {
      db.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 10000, 10000, ?, 0, ?)`,
      ).run(id, 'clinic-v2-001', now, now, 'patient-demo-001', `CHG-${id}`, overrides.refundedAmount, overrides.status);
    };
    const insertRefund = (id: string, chargeId: string, amount: number, status: string): void => {
      db.prepare(
        `INSERT INTO Refund (
           id, clinicId, createdAt, updatedAt, deletedAt,
           chargeId, patientId, amount, reason, operatorId, status
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(id, 'clinic-v2-001', now, now, chargeId, 'patient-demo-001', amount, `原因-${id}`, 'user-admin-001', status);
    };

    insertCharge('route-charge-1', { refundedAmount: 3000, status: 'PAID' });
    insertCharge('route-charge-2', { refundedAmount: 5000, status: 'PAID' });
    insertCharge('route-charge-3', { refundedAmount: 2000, status: 'PAID' });
    insertCharge('route-charge-4', { refundedAmount: 1000, status: 'PAID' });
    insertCharge('route-charge-5', { refundedAmount: 4000, status: 'PAID' });
    insertCharge('route-charge-7', { refundedAmount: 6000, status: 'PAID' });
    insertRefund('route-refund-1', 'route-charge-1', 3000, 'REQUESTED');
    insertRefund('route-refund-2', 'route-charge-2', 5000, 'PENDING_REFUND');
    insertRefund('route-refund-3', 'route-charge-3', 2000, 'REQUESTED');
    insertRefund('route-refund-4', 'route-charge-4', 1000, 'REQUESTED');
    insertRefund('route-refund-5', 'route-charge-5', 4000, 'COMPLETED');
    insertRefund('route-refund-7', 'route-charge-7', 6000, 'REQUESTED');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/v2/refunds returns the refund list with joined fields', async () => {
    const res = await request(app).get('/api/v2/refunds').expect(200);
    expect(res.body.success).toBe(true);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const row = rows.find((entry) => entry.id === 'route-refund-1') as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.patientName).toBe('Demo Patient');
    expect(row.chargeId).toBe('route-charge-1');
    expect(row.chargeNumber).toBe('CHG-route-charge-1');
    expect(row.amount).toBe(3000);
    expect(row.status).toBe('REQUESTED');
    expect(row.reason).toBe('原因-route-refund-1');
  });

  it('POST /api/v2/refunds/:id/approve approves a REQUESTED refund', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/route-refund-1/approve')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-refund-1', status: 'PENDING_REFUND', approvedAt: now });
    const row = db.prepare('SELECT * FROM Refund WHERE id = ?').get('route-refund-1') as Record<string, unknown>;
    expect(row.status).toBe('PENDING_REFUND');
    expect(row.approvedById).toBe('user-admin-001');
    expect(row.approvedAt).toBe(now);
  });

  it('POST /api/v2/refunds/:id/process completes a PENDING_REFUND refund', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/route-refund-2/process')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-refund-2', status: 'COMPLETED', processedAt: now });
    const row = db.prepare('SELECT * FROM Refund WHERE id = ?').get('route-refund-2') as Record<string, unknown>;
    expect(row.status).toBe('COMPLETED');
    expect(row.processedById).toBe('user-admin-001');
    expect(row.processedAt).toBe(now);
  });

  it('POST /api/v2/refunds/:id/reject rejects a REQUESTED refund and rolls back the charge', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/route-refund-3/reject')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-refund-3', status: 'REJECTED' });
    const row = db.prepare('SELECT * FROM Refund WHERE id = ?').get('route-refund-3') as Record<string, unknown>;
    expect(row.status).toBe('REJECTED');
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get('route-charge-3') as Record<string, unknown>;
    expect(charge.refundedAmount).toBe(0);
    expect(charge.status).toBe('PAID');
  });

  it('POST /api/v2/refunds/:id/cancel cancels a REQUESTED refund', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/route-refund-4/cancel')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-refund-4', status: 'CANCELLED' });
    const row = db.prepare('SELECT * FROM Refund WHERE id = ?').get('route-refund-4') as Record<string, unknown>;
    expect(row.status).toBe('CANCELLED');
  });

  it('returns 409 when approving an already completed refund', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/route-refund-5/approve')
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('仅待审核的退款可审批通过');
  });

  it('returns 409 when processing a REQUESTED refund', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/route-refund-7/process')
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('仅待退款的记录可确认完成');
  });

  it('returns 404 for a missing refund', async () => {
    const res = await request(app)
      .post('/api/v2/refunds/missing-refund/approve')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Refund not found');
  });
});
