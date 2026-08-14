// AppointmentService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppointmentService } from './appointment.service';
import type { AppContext } from '../../../domain/contracts';

describe('AppointmentService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-appointment-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('covers appointment validation and conflict branches', async () => {
    const service = new AppointmentService(db);
    const base = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      startTime: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString(),
      type: 'REGULAR',
    };
    db.prepare(
      `INSERT INTO Chair (id, clinicId, createdAt, updatedAt, deletedAt, name, location, active)
       VALUES (?, ?, ?, ?, NULL, 'Edge Chair', 'Room 2', 1)`,
    ).run('chair-1', context.clinicId, new Date().toISOString(), new Date().toISOString());
    await expect(service.create({ ...base, doctorId: 'missing-doctor' }, context))
      .rejects.toThrow('Doctor not found');
    await expect(service.create({ ...base, chairId: 'missing-chair' }, context))
      .rejects.toThrow('Chair not found');
    const created = await service.create({ ...base, chairId: 'chair-1', remark: 'r' }, context);
    expect(db.prepare(
      `SELECT 1 FROM SyncChange WHERE tableName = 'Appointment' AND recordId = ? AND operation = 'INSERT' AND clinicId = ?`,
    ).get(String(created.id), context.clinicId)).toBeDefined();
    await expect(service.transition('missing-appointment', 'ARRIVED', context)).rejects.toThrow('Appointment not found');
    await expect(service.transition(String(created.id), 'INVALID', context)).rejects.toThrow('Cannot transition');
    await expect(service.create({ ...base, startTime: 'bad', endTime: 'worse' }, context)).rejects.toThrow('endTime');
    await expect(service.create(base, context)).rejects.toThrow('already booked');
  });

  it('guards appointment transitions against stale status', async () => {
    const service = new AppointmentService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      startTime: new Date(Date.now() + 11 * 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 11 * 86_400_000 + 3_600_000).toISOString(),
      type: 'REGULAR',
    }, context);
    await service.transition(String(created.id), 'ARRIVED', context);
    expect(db.prepare(
      `SELECT 1 FROM SyncChange WHERE tableName = 'Appointment' AND recordId = ? AND operation = 'UPDATE' AND clinicId = ?`,
    ).get(String(created.id), context.clinicId)).toBeDefined();
    await expect(service.transition(String(created.id), 'NO_SHOW', context))
      .rejects.toThrow('Cannot transition appointment from ARRIVED to NO_SHOW');
  });
});
