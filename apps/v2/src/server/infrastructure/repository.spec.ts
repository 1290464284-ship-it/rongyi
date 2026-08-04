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

  it('maps unique index violations to conflicts and allows code reuse after soft delete', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    const first = {
      id: 'repo-duplicate-1',
      code: 'DUP-AUDIT',
      name: 'Duplicate Audit',
      gender: 'UNKNOWN',
      phone: '13200000004',
      source: 'WALK_IN',
      active: true,
    };
    await repo.insert(first, context);
    await expect(repo.insert({ ...first, id: 'repo-duplicate-2' }, context)).rejects.toMatchObject({ status: 409 });
    await repo.softDelete('repo-duplicate-1', context);
    await expect(repo.insert({ ...first, id: 'repo-duplicate-2' }, context)).resolves.toBeUndefined();
    await repo.insert({ ...first, id: 'repo-duplicate-3', code: 'DUP-OTHER' }, context);
    await expect(repo.update({ id: 'repo-duplicate-3', code: 'DUP-AUDIT' }, context)).rejects.toMatchObject({ status: 409 });
  });

  it('rethrows non-unique database failures without hiding them', async () => {
    const base = resourceRegistry.get('patients')!;
    const badResource = {
      ...base,
      name: 'bad-patients',
      fields: [...base.fields, { name: 'missingColumn', type: 'text' }],
    } as unknown as typeof base;
    const repo = new SqliteRepository(db, badResource);
    await expect(repo.insert({
      id: 'repo-bad-insert',
      code: 'BAD-INSERT',
      name: 'Bad Insert',
      gender: 'UNKNOWN',
      source: 'WALK_IN',
      active: true,
      missingColumn: 'x',
    }, context)).rejects.toThrow(/no (such )?column/);
    await new SqliteRepository(db, base).insert({
      id: 'repo-bad-insert',
      code: 'BAD-INSERT-VALID',
      name: 'Bad Insert',
      gender: 'UNKNOWN',
      source: 'WALK_IN',
      active: true,
    }, context);
    await expect(repo.update({ id: 'repo-bad-insert', missingColumn: 'y' }, context)).rejects.toThrow(/no (such )?column/);
  });

  it('keeps non-Error database failures intact', async () => {
    const throwingDb = {
      prepare: () => ({ run: () => { throw 'non-error'; } }),
    } as unknown as Database.Database;
    const repo = new SqliteRepository(throwingDb, resourceRegistry.get('patients')!);
    await expect(repo.insert({
      id: 'repo-non-error',
      code: 'NON-ERROR',
      name: 'Non Error',
      gender: 'UNKNOWN',
      source: 'WALK_IN',
      active: true,
    }, context)).rejects.toBe('non-error');
  });

  it('recognizes unique failures reported only through the error message', async () => {
    const throwingDb = {
      prepare: () => ({
        run: () => { throw new Error('UNIQUE constraint failed: Patient.code'); },
      }),
    } as unknown as Database.Database;
    const repo = new SqliteRepository(throwingDb, resourceRegistry.get('patients')!);
    await expect(repo.insert({
      id: 'repo-message-unique',
      code: 'MESSAGE-UNIQUE',
      name: 'Message Unique',
      gender: 'UNKNOWN',
      source: 'WALK_IN',
      active: true,
    }, context)).rejects.toMatchObject({ status: 409 });
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

  it('serializes nullish JSON, invalid JSON, unknown filters, and missing updates', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-json-null',
      code: 'JSON-NULL',
      name: 'JSON Null',
      gender: 'UNKNOWN',
      phone: '13200000001',
      source: 'WALK_IN',
      active: false,
      tags: undefined,
      allergies: [],
      medicalHistory: [],
      medicationHistory: [],
      systemicDiseases: [],
    }, context);
    const nullRow = await repo.findById('repo-json-null', context);
    expect(nullRow?.tags).toBeNull();
    expect(nullRow?.active).toBe(false);

    await repo.insert({
      id: 'repo-json-invalid',
      code: 'JSON-INVALID',
      name: 'JSON Invalid',
      gender: 'UNKNOWN',
      phone: '13200000002',
      source: 'WALK_IN',
      active: true,
      tags: 'not-json',
      allergies: [],
      medicalHistory: [],
      medicationHistory: [],
      systemicDiseases: [],
    }, context);
    const invalidRow = await repo.findById('repo-json-invalid', context);
    expect(invalidRow?.tags).toBe('not-json');

    await expect(repo.findMany({ page: 1, pageSize: 10, filters: { unknownField: 'x' } }, context))
      .rejects.toThrow('Unknown filter field');
    await expect(repo.update({ id: 'repo-missing-update' }, context))
      .rejects.toThrow('not found');
  });

  it('hard-deletes resources that do not support soft delete', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('settings')!);
    await repo.insert({ id: 'setting-clinic', key: 'clinic-key', value: 'v' }, context);
    await repo.softDelete('setting-clinic', context);
    expect(db.prepare('SELECT id FROM Setting WHERE id = ?').get('setting-clinic')).toBeUndefined();

    await repo.insert({ id: 'setting-global', key: 'global-key', value: 'v' }, {
      userId: 'u1',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    });
    await repo.softDelete('setting-global', {
      userId: 'u1',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    });
    expect(db.prepare('SELECT id FROM Setting WHERE id = ?').get('setting-global')).toBeUndefined();
  });

  it('covers query defaults, clamping, clinic filtering, and search absence', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    const defaults = await repo.findMany({}, context);
    expect(defaults.page).toBe(1);
    expect(defaults.pageSize).toBe(20);

    const globalRepo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    const globalContext = {
      userId: 'u1',
      clinicId: null,
      role: 'BOSS' as const,
      traceId: 'trace',
      now: () => new Date(),
    };
    await globalRepo.insert({
      id: 'repo-global',
      code: 'GLOBAL-1',
      name: 'Global Patient',
      gender: 'UNKNOWN',
      phone: '13200000009',
      source: 'WALK_IN',
      active: true,
    }, globalContext);
    const globalRow = await globalRepo.findById('repo-global', globalContext);
    expect(globalRow?.id).toBe('repo-global');
    await globalRepo.update({ id: 'repo-global', name: 'Global Renamed' }, globalContext);
    await globalRepo.softDelete('repo-global', globalContext);
    expect(await globalRepo.findById('repo-global', globalContext)).toBeNull();

    const clamped = await repo.findMany({ page: 0, pageSize: 999, search: 'Repo' }, {
      userId: 'u1',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    });
    expect(clamped.page).toBe(1);
    expect(clamped.pageSize).toBe(200);
    expect(clamped.total).toBeGreaterThanOrEqual(0);
  });

  it('covers custom resources without searchable fields or default sort', async () => {
    const base = resourceRegistry.get('patients')!;
    const patientRepo = new SqliteRepository(db, base);
    await patientRepo.insert({
      id: 'repo-custom',
      code: 'CUSTOM-1',
      name: 'Custom Patient',
      gender: 'UNKNOWN',
      phone: '13200000003',
      source: 'WALK_IN',
      active: true,
      tags: [],
      allergies: [],
      medicalHistory: [],
      medicationHistory: [],
      systemicDiseases: [],
    }, context);

    const customResource = {
      ...base,
      name: 'custom-patients',
      searchableFields: undefined,
      defaultSort: undefined,
      fields: [...base.fields, { name: 'missingField', type: 'text' }],
    } as unknown as typeof base;
    const customRepo = new SqliteRepository(db, customResource);
    await customRepo.findMany({ page: 1, pageSize: 10 }, context);
    await customRepo.findMany({ page: 1, pageSize: 10, search: 'Custom' }, context);
    await customRepo.findMany({ page: 1, pageSize: 10, sortBy: 'missing' }, {
      userId: 'u1',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    });
    const row = await customRepo.findById('repo-custom', context);
    expect(row?.name).toBe('Custom Patient');
  });
});
