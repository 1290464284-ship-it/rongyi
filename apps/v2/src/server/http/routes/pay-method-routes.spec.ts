import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { registerPayMethodRoutes } from './pay-method-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('pay method routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-pay-method-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    db.prepare(
      `INSERT INTO PayMethod (
         id, clinicId, createdAt, updatedAt, deletedAt, name, parentId, sortOrder, active, remark
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    ).run('route-pm-cash', nowIso, nowIso, '现金', null, 1, 1);
    db.prepare(
      `INSERT INTO PayMethod (
         id, clinicId, createdAt, updatedAt, deletedAt, name, parentId, sortOrder, active, remark
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    ).run('route-pm-electronic', nowIso, nowIso, '电子支付', null, 2, 1);
    db.prepare(
      `INSERT INTO PayMethod (
         id, clinicId, createdAt, updatedAt, deletedAt, name, parentId, sortOrder, active, remark
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    ).run('route-pm-wechat', nowIso, nowIso, '微信', 'route-pm-electronic', 1, 1);

    app = express();
    app.use((req, _res, next) => {
      (req as unknown as { context: unknown }).context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date(nowIso),
      };
      next();
    });
    registerPayMethodRoutes(app, buildRouteDeps(db));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/v2/pay-methods/tree returns the two-level pay method tree', async () => {
    const res = await request(app).get('/api/v2/pay-methods/tree').expect(200);
    expect(res.body.success).toBe(true);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.map((node) => node.id)).toEqual(['route-pm-cash', 'route-pm-electronic']);
    const electronic = items.find((node) => node.id === 'route-pm-electronic')!;
    expect(electronic.children).toEqual([
      expect.objectContaining({ id: 'route-pm-wechat', name: '微信', parentId: 'route-pm-electronic' }),
    ]);
    expect(items.find((node) => node.id === 'route-pm-cash')?.children).toEqual([]);
  });
});
