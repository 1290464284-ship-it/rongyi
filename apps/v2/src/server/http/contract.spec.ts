import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import {
  errorEnvelopeSchema,
  healthEnvelopeSchema,
  loginEnvelopeSchema,
  resourceDetailEnvelopeSchema,
  resourceListEnvelopeSchema,
  resourceMetaEnvelopeSchema,
  validateContract,
} from './contract-schemas';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';

describe('public HTTP contract', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-contract-'));
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
    const login = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'admin', password: 'v2-test-seed-password' })
      .expect(200);
    expect(validateContract(loginEnvelopeSchema, login.body)).toEqual([]);
    token = login.body.data.token as string;
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns a consistent success envelope with request id for health', async () => {
    const res = await request(app).get('/api/v2/health').expect(200);
    expect(validateContract(healthEnvelopeSchema, res.body)).toEqual([]);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok', time: expect.any(String) },
    });
    expect(res.headers['x-request-id']).toMatch(/^[a-zA-Z0-9-]{8,64}$/);
  });

  it('returns a consistent not-found envelope', async () => {
    const res = await request(app)
      .get('/not-found')
      .expect(404);
    expect(validateContract(errorEnvelopeSchema, res.body)).toEqual([]);
    expect(res.body).toEqual({
      success: false,
      code: 'NOT_FOUND',
      message: 'Route not found',
    });
  });

  it('returns the public unauthorized envelope without leaking stack details', async () => {
    const res = await request(app).get('/api/v2/resources/patients').expect(401);
    expect(validateContract(errorEnvelopeSchema, res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Missing bearer token',
      traceId: expect.any(String),
    });
    expect(res.body.stack).toBeUndefined();
    expect(res.headers['x-request-id']).toBe(res.body.traceId);
  });

  it('returns validation errors with stable fields', async () => {
    const res = await request(app)
      .get('/api/v2/resources/patients?page=abc')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(validateContract(errorEnvelopeSchema, res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
      traceId: expect.any(String),
    });
  });

  it('exports CSV with the expected headers and response metadata', async () => {
    const res = await request(app)
      .get('/api/v2/resources/patients/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="patients-');
    expect(res.text.startsWith('\uFEFF')).toBe(true);
  });

  it('validates the authenticated resource list envelope against the published schema', async () => {
    const res = await request(app)
      .get('/api/v2/resources/patients?page=1&pageSize=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(validateContract(resourceListEnvelopeSchema, res.body)).toEqual([]);
  });

  it('validates resource meta and detail envelopes against their schemas', async () => {
    const meta = await request(app)
      .get('/api/v2/resource-meta')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(validateContract(resourceMetaEnvelopeSchema, meta.body)).toEqual([]);

    const list = await request(app)
      .get('/api/v2/resources/patients?page=1&pageSize=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const patientId = (list.body.data.items?.[0] as { id?: string } | undefined)?.id;
    expect(patientId).toBeTruthy();
    const detail = await request(app)
      .get(`/api/v2/resources/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(validateContract(resourceDetailEnvelopeSchema, detail.body)).toEqual([]);
  });

  it('maps contract validation errors with stable instance paths', () => {
    const errors = validateContract(loginEnvelopeSchema, { success: false });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.startsWith('/') || error.startsWith('data/'))).toBe(true);
  });
});
