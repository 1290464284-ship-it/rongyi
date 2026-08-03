import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { SqliteRepository } from './repository';
import { resourceRegistry } from '../../domain/resources';
import type { AppContext } from '../../domain/contracts';

describe('SqliteRepository', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repo-'));
    db = createDatabase(dataDir);
    context = {
      userId: 'u1',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('inserts, lists, updates, and soft-deletes a patient', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-patient-1',
      code: 'RPT-001',
      name: 'Repo Patient',
      gender: 'UNKNOWN',
      phone: '13200000000',
      source: 'WALK_IN',
      active: true,
      tags: [],
      allergies: [],
      medicalHistory: [],
      medicationHistory: [],
      systemicDiseases: [],
    }, context);
    const page = await repo.findMany({ page: 1, pageSize: 10, search: 'Repo' }, context);
    expect(page.total).toBe(1);
    expect(page.items[0].name).toBe('Repo Patient');

    await repo.update({ id: 'repo-patient-1', name: 'Renamed Patient' }, context);
    const updated = await repo.findById('repo-patient-1', context);
    expect(updated?.name).toBe('Renamed Patient');

    await repo.softDelete('repo-patient-1', context);
    expect(await repo.findById('repo-patient-1', context)).toBeNull();
  });

  it('masks sensitive user fields returned by generic repository', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('users')!);
    await repo.insert({
      id: 'repo-user-1',
      username: 'repo-admin',
      passwordHash: 'secret-hash',
      name: 'Repo Admin',
      role: 'BOSS',
      active: true,
      loginAttempts: 0,
      tokenVersion: 0,
    }, context);
    const user = await repo.findById('repo-user-1', context);
    expect(user?.passwordHash).toBeNull();
  });
});

