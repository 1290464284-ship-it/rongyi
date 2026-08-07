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
import { createResourceRouter } from '../router';

describe('imaging category resource chain', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-06T08:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-imaging-category-'));
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
        now: () => new Date(now),
      };
      next();
    });
    app.use('/api/v2/resources', createResourceRouter(db));
    // 错误中间件必须保持 4 参，Express 才将其识别为错误处理器。
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

  it('creates an imaging category and persists the DB row', async () => {
    const created = await request(app)
      .post('/api/v2/resources/imagingCategories')
      .send({ name: '正畸治疗前', type: 'ORTHODONTIC', sortOrder: 3, active: true })
      .expect(201);
    const id = created.body.data.id as string;
    const row = db.prepare(
      'SELECT name, type, sortOrder, active, clinicId FROM ImagingCategory WHERE id = ?',
    ).get(id) as { name: string; type: string; sortOrder: number; active: number; clinicId: string };
    expect(row.name).toBe('正畸治疗前');
    expect(row.type).toBe('ORTHODONTIC');
    expect(row.sortOrder).toBe(3);
    expect(row.active).toBe(1);
    expect(row.clinicId).toBe('clinic-v2-001');
  });

  it('creates an imaging record carrying categoryId and phase', async () => {
    const category = await request(app)
      .post('/api/v2/resources/imagingCategories')
      .send({ name: '美学对比', type: 'AESTHETIC', active: true })
      .expect(201);
    const categoryId = category.body.data.id as string;

    const created = await request(app)
      .post('/api/v2/resources/imaging')
      .send({
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        type: 'PANORAMIC',
        title: '正畸全景片',
        imageUrl: '/api/v2/files/route-a.png',
        takenAt: now,
        categoryId,
        phase: 'IN_PROGRESS',
      })
      .expect(201);
    const id = created.body.data.id as string;
    const row = db.prepare(
      'SELECT patientId, doctorId, title, imageUrl, categoryId, phase FROM Imaging WHERE id = ?',
    ).get(id) as {
      patientId: string;
      doctorId: string;
      title: string;
      imageUrl: string;
      categoryId: string | null;
      phase: string | null;
    };
    expect(row.title).toBe('正畸全景片');
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.imageUrl).toBe('/api/v2/files/route-a.png');
    expect(row.categoryId).toBe(categoryId);
    expect(row.phase).toBe('IN_PROGRESS');
  });

  it('toggles category active via PATCH and persists it', async () => {
    const created = await request(app)
      .post('/api/v2/resources/imagingCategories')
      .send({ name: '石膏模型', type: 'PLASTER', active: true })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app)
      .patch(`/api/v2/resources/imagingCategories/${id}`)
      .send({ active: false })
      .expect(200);

    const row = db.prepare('SELECT active FROM ImagingCategory WHERE id = ?').get(id) as { active: number };
    expect(row.active).toBe(0);
  });
});
