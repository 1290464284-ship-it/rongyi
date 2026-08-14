import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app';
import { validateContract } from './contract-schemas';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { Logger } from '../infrastructure/logger';

const specPath = path.resolve(import.meta.dirname, '../../../openapi.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
  components?: { schemas?: Record<string, object> };
};

describe('OpenAPI live response validation', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-openapi-live-'));
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
    token = login.body.data.token as string;
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function schema(name: string): object {
    const found = spec.components?.schemas?.[name];
    if (!found) throw new Error(`missing schema ${name}`);
    return found;
  }

  it('health matches OpenAPI HealthEnvelope', async () => {
    const res = await request(app).get('/api/v2/health').expect(200);
    expect(validateContract(schema('HealthEnvelope'), res.body)).toEqual([]);
  });

  it('login matches OpenAPI LoginEnvelope', async () => {
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: 'admin', password: 'v2-test-seed-password' })
      .expect(200);
    expect(validateContract(schema('LoginEnvelope'), res.body)).toEqual([]);
  });

  it('resource meta matches OpenAPI ResourceMetaEnvelope', async () => {
    const res = await request(app)
      .get('/api/v2/resource-meta')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(validateContract(schema('ResourceMetaEnvelope'), res.body)).toEqual([]);
  });

  it('patient list matches OpenAPI ResourceListEnvelope', async () => {
    const res = await request(app)
      .get('/api/v2/resources/patients?page=1&pageSize=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(validateContract(schema('ResourceListEnvelope'), res.body)).toEqual([]);
  });

  it('patient detail matches OpenAPI ResourceDetailEnvelope', async () => {
    const list = await request(app)
      .get('/api/v2/resources/patients?page=1&pageSize=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const id = (list.body.data.items?.[0] as { id?: string } | undefined)?.id;
    expect(id).toBeTruthy();
    const res = await request(app)
      .get(`/api/v2/resources/patients/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(validateContract(schema('ResourceDetailEnvelope'), res.body)).toEqual([]);
  });
});
