import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  let currentRole: string;
  const now = '2026-08-09T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-custom-field-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    currentRole = 'BOSS';

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

  afterEach(() => {
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
    await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: 'DOCTOR Readable', fieldName: 'doctorReadable', fieldType: 'TEXT' })
      .expect(201);
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

  it('BOSS updates, reads values, and deletes definitions', async () => {
    currentRole = 'BOSS';
    const created = await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: '更新偏好', fieldName: 'updatePreference', fieldType: 'TEXT' })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app)
      .patch(`/api/v2/custom-fields/${id}`)
      .send({ label: '已更新偏好', fieldName: 'updatePreference', fieldType: 'TEXT' })
      .expect(200);

    const values = await request(app)
      .get('/api/v2/custom-fields/values?entity=patient&entityId=patient-route-2')
      .expect(200);
    expect(values.body.success).toBe(true);

    await request(app)
      .delete(`/api/v2/custom-fields/${id}`)
      .expect(200);
  });

  it('DOCTOR cannot update or delete definitions', async () => {
    currentRole = 'DOCTOR';
    await request(app)
      .patch('/api/v2/custom-fields/not-found')
      .send({ label: 'x' })
      .expect(403);
    await request(app)
      .delete('/api/v2/custom-fields/not-found')
      .expect(403);
  });

  it('rejects non-array custom field values', async () => {
    currentRole = 'BOSS';
    await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: 'Non-array validation', fieldName: 'nonArrayValidation', fieldType: 'TEXT' })
      .expect(201);
    const res = await request(app)
      .put('/api/v2/custom-fields/values')
      .send({ entity: 'patient', entityId: 'patient-route-3', values: 'not-an-array' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('falls back to default entity and tolerates missing bodies', async () => {
    const listed = await request(app).get('/api/v2/custom-fields').expect(200);
    expect(listed.body.success).toBe(true);
    const values = await request(app).get('/api/v2/custom-fields/values');
    expect(values.status).toBe(400);

    const created = await request(app)
      .post('/api/v2/custom-fields')
      .send({ label: '无实体字段', fieldName: 'noEntityField', fieldType: 'TEXT' })
      .expect(201);
    expect(created.body.success).toBe(true);

    const emptyPost = await request(app).post('/api/v2/custom-fields');
    expect(emptyPost.status).toBe(400);
    const emptyPut = await request(app).put('/api/v2/custom-fields/values');
    expect([200, 400]).toContain(emptyPut.status);
  });

  it('tolerates a missing PATCH body', async () => {
    currentRole = 'BOSS';
    const created = await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: '空体更新', fieldName: 'noBodyUpdate', fieldType: 'TEXT' })
      .expect(201);
    const id = created.body.data.id as string;
    const res = await request(app).patch(`/api/v2/custom-fields/${id}`);
    expect([200, 400]).toContain(res.status);
  });

  it('normalizes boolean values and select options', async () => {
    const booleanField = await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: '启用标记', fieldName: 'enabledFlag', fieldType: 'BOOLEAN' })
      .expect(201);
    const fieldId = booleanField.body.data.id as string;
    await request(app)
      .put('/api/v2/custom-fields/values')
      .send({ entity: 'patient', entityId: 'patient-boolean-1', values: [{ fieldId, value: 'true' }] })
      .expect(200);
    const values = await request(app)
      .get('/api/v2/custom-fields/values?entity=patient&entityId=patient-boolean-1')
      .expect(200);
    expect(values.body.data.values[fieldId]).toBe('1');

    await request(app)
      .post('/api/v2/custom-fields')
      .send({ entity: 'patient', label: '坏类型', fieldName: 'badType', fieldType: 'BOGUS' })
      .expect(400);
    await request(app)
      .post('/api/v2/custom-fields')
      .send({
        entity: 'patient',
        label: '选项',
        fieldName: 'choiceField',
        fieldType: 'SELECT',
        options: [' a ', '', 'b '],
      })
      .expect(201);
    const listed = await request(app).get('/api/v2/custom-fields?entity=patient').expect(200);
    const choice = (listed.body.data as Array<{ fieldName: string; optionsJson: string }>)
      .find((field) => field.fieldName === 'choiceField');
    expect(JSON.parse(choice?.optionsJson ?? '[]')).toEqual(['a', 'b']);
  });
});
