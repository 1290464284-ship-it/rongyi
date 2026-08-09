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
import { registerCustomFieldRoutes } from './custom-field-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('custom field routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  let currentRole = 'BOSS';
  const now = '2026-08-09T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-custom-field-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: currentRole as 'BOSS' | 'DOCTOR',
        permissions: ['dashboard', 'system'],
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    registerCustomFieldRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('BOSS creates and lists definitions', async () => {
    const created = await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: '就诊偏好', fieldName: 'visitPreference', fieldType: 'TEXT' })
      .expect(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data.fieldName).toBe('visitPreference');

    const listed = await request(app).get('/api/v2/custom-fields?entity=patient').expect(200);
    expect(listed.body.data.some((field: { fieldName: string }) => field.fieldName === 'visitPreference')).toBe(true);
  });

  it('DOCTOR cannot create definitions but can read and write values', async () => {
    currentRole = 'DOCTOR';
    await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: 'x', fieldName: 'xField', fieldType: 'TEXT' })
      .expect(403);

    const listed = await request(app).get('/api/v2/custom-fields?entity=patient').expect(200);
    const field = listed.body.data[0];
    const saved = await request(app)
      .put('/api/v2/custom-fields/values')
      .send({ entity: 'patient', entityId: 'patient-route-1', values: [{ fieldId: field.id, value: 'ok' }] })
      .expect(200);
    expect(saved.body.data[field.id]).toBe('ok');
  });
});
