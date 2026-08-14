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
import { resourceRegistry } from '../../domain/resources';
import { errorEnvelopeSchema, resourceListEnvelopeSchema, validateContract } from './contract-schemas';

const genericSuccessEnvelopeSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['success', 'data'],
  properties: { success: { const: true }, data: {} },
};

const COMMON_COLUMNS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'clinicId']);
const ALLOWED_EXTRA_FIELDS: Record<string, string[]> = {
  users: ['refreshToken', 'refreshTokenExpiresAt', 'currentClinicId'],
};

describe('OpenAPI live handler coverage', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-openapi-live-coverage-'));
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

  it('exercises every live GET route without a 5xx and validates envelope shapes', async () => {
    const routes = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../../openapi-routes.json'), 'utf8'),
    ) as Array<{ method: string; path: string }>;
    const failures: string[] = [];

    async function checkResponse(label: string, res: { status: number; body: unknown }) {
      if (res.status >= 500) {
        failures.push(`${label}: status ${res.status}`);
        return;
      }
      if (res.status >= 400) {
        const errors = validateContract(errorEnvelopeSchema, res.body);
        if (errors.length > 0) failures.push(`${label}: ${errors.join('; ')}`);
        return;
      }
      const body = res.body as { success?: boolean } | undefined;
      if (body && typeof body === 'object' && body.success === true) {
        const errors = validateContract(genericSuccessEnvelopeSchema, body);
        if (errors.length > 0) failures.push(`${label}: ${errors.join('; ')}`);
      }
    }

    for (const route of routes.filter((route) => route.method === 'GET')) {
      if (route.path === '/api/v2/resources/:resource') {
        for (const definition of resourceRegistry.all()) {
          const res = await request(app)
            .get(`/api/v2/resources/${definition.name}?page=1&pageSize=1`)
            .set('Authorization', `Bearer ${token}`);
          await checkResponse(`GET /resources/${definition.name}`, res);
        }
        continue;
      }
      if (route.path === '/api/v2/resources/:resource/:id') {
        for (const definition of resourceRegistry.all()) {
          const list = await request(app)
            .get(`/api/v2/resources/${definition.name}?page=1&pageSize=1`)
            .set('Authorization', `Bearer ${token}`);
          const id = (list.body?.data?.items?.[0] as { id?: unknown } | undefined)?.id;
          if (id === undefined) continue;
          const res = await request(app)
            .get(`/api/v2/resources/${definition.name}/${encodeURIComponent(String(id))}`)
            .set('Authorization', `Bearer ${token}`);
          await checkResponse(`GET /resources/${definition.name}/{id}`, res);
        }
        continue;
      }
      if (route.path === '/api/v2/resources/:resource/export') {
        const res = await request(app)
          .get('/api/v2/resources/patients/export')
          .set('Authorization', `Bearer ${token}`);
        await checkResponse('GET /resources/patients/export', res);
        continue;
      }
      const expressPath = route.path.startsWith('/api/v2') ? route.path.slice('/api/v2'.length) || '/' : route.path;
      const pathWithPlaceholders = expressPath.replace(/:[A-Za-z0-9_]+/g, '__missing__');
      const res = await request(app)
        .get(`/api/v2${pathWithPlaceholders}`)
        .set('Authorization', `Bearer ${token}`);
      await checkResponse(`${route.method} ${expressPath}`, res);
    }

    expect(failures).toEqual([]);
  });

  it('keeps resource list rows aligned with their declared schemas', async () => {
    const failures: string[] = [];
    for (const definition of resourceRegistry.all()) {
      const res = await request(app)
        .get(`/api/v2/resources/${definition.name}?page=1&pageSize=1`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status >= 500) {
        failures.push(`${definition.name}: status ${res.status}`);
        continue;
      }
      if (res.status >= 400) {
        continue;
      }
      const errors = validateContract(resourceListEnvelopeSchema, res.body);
      if (errors.length > 0) {
        failures.push(`${definition.name}: ${errors.join('; ')}`);
        continue;
      }
      const row = res.body?.data?.items?.[0] as Record<string, unknown> | undefined;
      if (!row) continue;
      const declared = new Set(definition.fields.map((field) => field.name));
      const allowedExtras = new Set(ALLOWED_EXTRA_FIELDS[definition.name] ?? []);
      const unexpected = Object.keys(row).filter(
        (key) => !declared.has(key) && !COMMON_COLUMNS.has(key) && !key.endsWith('Label') && !allowedExtras.has(key),
      );
      if (unexpected.length > 0) failures.push(`${definition.name}: unexpected columns ${unexpected.join(', ')}`);
    }
    expect(failures).toEqual([]);
  });
});
