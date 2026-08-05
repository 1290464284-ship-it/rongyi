import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { SqliteRepository } from './repository';
import { rebuildSearchIndex, upsertSearchRow } from './search-index';
import { resourceRegistry } from '../../domain/resources';
import type { AppContext } from '../../domain/contracts';

describe('SqliteRepository', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repo-'));
    db = createDatabase(dataDir);
    // createDatabase 不跑迁移，按迁移 115 的 DDL 建 FTS 表供 FTS 分支用例使用。
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS SearchIndex USING fts5(
      resource UNINDEXED,
      recordId UNINDEXED,
      clinicId UNINDEXED,
      content
    )`);
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
    // 迁移 119 已移除 FTS 触发器（按需重建索引），搜索前需显式重建。
    rebuildSearchIndex(db);
    const page = await repo.findMany({ page: 1, pageSize: 10, search: 'Repo' }, context);
    expect(page.total).toBe(1);
    expect(page.items[0].name).toBe('Repo Patient');

    await repo.update({ id: 'repo-patient-1', name: 'Renamed Patient' }, context);
    const updated = await repo.findById('repo-patient-1', context);
    expect(updated?.name).toBe('Renamed Patient');

    await repo.softDelete('repo-patient-1', context);
    expect(await repo.findById('repo-patient-1', context)).toBeNull();
  });

  it('applies declared defaults and hides null-clinic rows from scoped queries', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-legacy-defaults',
      code: 'LEGACY-DEFAULT',
      name: 'Legacy Default',
      gender: 'UNKNOWN',
      source: 'WALK_IN',
    }, context);
    const legacyRow = await repo.findById('repo-legacy-defaults', context);
    expect(legacyRow?.active).toBe(true);
    expect(legacyRow?.tags).toEqual([]);
    // 严格租户隔离：NULL clinicId 行对 scoped 查询不可见（迁移 121 已回填）。
    const unscopedContext = { ...context, clinicId: null };
    await repo.insert({
      id: 'repo-null-clinic',
      code: 'NULL-CLINIC',
      name: 'Null Clinic Row',
      gender: 'UNKNOWN',
      source: 'WALK_IN',
    }, unscopedContext);
    expect(await repo.findById('repo-null-clinic', context)).toBeNull();
    const page = await repo.findMany({}, context);
    expect(page.total).toBeGreaterThanOrEqual(1);
  });

  it('rejects generic writes with missing relation targets', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('wechatMessages')!);
    await expect(repo.insert({
      id: 'repo-orphan-wechat',
      patientId: 'missing-patient',
      type: 'TEXT',
      content: 'x',
      status: 'PENDING',
    }, context)).rejects.toThrow('patients not found');
  });

  it('skips relation validation for unknown relation resources', async () => {
    const base = resourceRegistry.get('wechatMessages')!;
    const customResource = {
      ...base,
      name: 'custom-wechat',
      fields: [...base.fields, {
        name: 'legacyRef',
        type: 'text',
        relation: { resource: 'missing-relation', foreignKey: 'legacyRef', labelField: 'id' },
      }],
    } as unknown as typeof base;
    const repo = new SqliteRepository(db, customResource);
    await expect(repo.insert({
      id: 'repo-relation-skip',
      patientId: null,
      type: 'TEXT',
      content: 'x',
      status: 'PENDING',
      legacyRef: 'x',
    }, context)).rejects.toThrow(/no (such )?column/);
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
      prepare: () => ({
        all: () => [{ name: 'id' }, { name: 'clinicId' }, { name: 'createdAt' }, { name: 'updatedAt' }, { name: 'deletedAt' }],
        run: () => { throw 'non-error'; },
      }),
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
        all: () => [{ name: 'id' }, { name: 'clinicId' }, { name: 'createdAt' }, { name: 'updatedAt' }, { name: 'deletedAt' }],
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
    const inactivePage = await repo.findMany({ page: 1, pageSize: 10, filters: { active: false } }, context);
    expect(inactivePage.items.every((row) => row.active === false)).toBe(true);

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

  it('routes search through the FTS index when searchIndexResource is declared', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-fts-hit',
      code: 'FTS-001',
      name: '张三',
      gender: 'UNKNOWN',
      phone: '13200000021',
      source: 'WALK_IN',
      active: true,
    }, context);
    await repo.insert({
      id: 'repo-fts-prefix',
      code: 'FTS-002',
      name: '王张三',
      gender: 'UNKNOWN',
      phone: '13200000022',
      source: 'WALK_IN',
      active: true,
    }, context);
    rebuildSearchIndex(db);
    const page = await repo.findMany({ page: 1, pageSize: 10, search: '张三' }, context);
    // FTS 前缀语义：token '王张三' 不以 '张三' 开头不命中；LIKE '%张三%' 则会命中两者。
    expect(page.items.map((row) => String(row.name))).toEqual(['张三']);
    expect(page.total).toBe(1);
  });

  it('keeps LIKE-based search for resources without searchIndexResource', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('chairs')!);
    await repo.insert({
      id: 'repo-chair-fts',
      name: '王张三椅',
      location: 'A区',
      active: true,
    }, context);
    const page = await repo.findMany({ page: 1, pageSize: 10, search: '张三' }, context);
    expect(page.items.map((row) => String(row.name))).toEqual(['王张三椅']);
  });

  it('maintains the SearchIndex row across insert, update, and soft delete', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-si-1',
      code: 'SI-001',
      name: 'Index Me',
      gender: 'UNKNOWN',
      phone: '13200000031',
      source: 'WALK_IN',
      active: true,
    }, context);
    const rows = (id: string) => db.prepare(
      `SELECT resource, recordId, content FROM SearchIndex WHERE resource = 'Patient' AND recordId = ?`,
    ).all(id) as Array<{ resource: string; recordId: string; content: string }>;

    expect(rows('repo-si-1')).toHaveLength(1);
    expect(rows('repo-si-1')[0].content).toContain('Index Me');
    expect(rows('repo-si-1')[0].content).toContain('13200000031');

    await repo.update({ id: 'repo-si-1', name: 'Index Renamed' }, context);
    expect(rows('repo-si-1')).toHaveLength(1);
    expect(rows('repo-si-1')[0].content).toContain('Index Renamed');
    expect(rows('repo-si-1')[0].content).not.toContain('Index Me');

    await repo.softDelete('repo-si-1', context);
    expect(rows('repo-si-1')).toHaveLength(0);
  });

  it('refreshes Appointment search rows when a patient is renamed through the repository', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-si-parent',
      code: 'SI-PARENT',
      name: 'Parent Name',
      gender: 'UNKNOWN',
      phone: '13200000032',
      source: 'WALK_IN',
      active: true,
    }, context);
    // 预约走专用服务而非通用仓储，这里直接建行并手动建索引行，模拟运行期已有索引。
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Appointment (id, clinicId, createdAt, updatedAt, patientId, startTime, endTime, status, type)
       VALUES ('repo-si-appt', 'clinic-v2-001', ?, ?, 'repo-si-parent', ?, ?, 'BOOKED', 'REGULAR')`,
    ).run(now, now, now, now);
    upsertSearchRow(db, 'Appointment', 'repo-si-appt');
    expect(
      db.prepare(`SELECT content FROM SearchIndex WHERE resource = 'Appointment' AND recordId = 'repo-si-appt'`).get(),
    ).toMatchObject({ content: expect.stringContaining('Parent Name') });

    await repo.update({ id: 'repo-si-parent', name: 'Renamed Parent' }, context);
    const rows = db.prepare(
      `SELECT content FROM SearchIndex WHERE resource = 'Appointment' AND recordId = 'repo-si-appt'`,
    ).all() as Array<{ content: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('Renamed Parent');
    expect(rows[0].content).not.toContain('Parent Name');
  });

  it('records sync changes for repository writes with the server device sentinel', async () => {
    const repo = new SqliteRepository(db, resourceRegistry.get('patients')!);
    await repo.insert({
      id: 'repo-sync-1', code: 'SYNC-001', name: 'Sync Patient', gender: 'UNKNOWN',
      phone: '13200000009', source: 'WALK_IN', active: true,
    }, context);
    const rowsFor = (): Array<{ tableName: string; operation: string; deviceId: string }> =>
      db.prepare(
        `SELECT tableName, operation, deviceId FROM SyncChange WHERE recordId = 'repo-sync-1' ORDER BY createdAt`,
      ).all() as Array<{ tableName: string; operation: string; deviceId: string }>;
    expect(rowsFor()).toHaveLength(1);
    expect(rowsFor()[0]).toMatchObject({ tableName: 'Patient', operation: 'INSERT', deviceId: 'server' });
    await repo.update({ id: 'repo-sync-1', name: 'Renamed Sync' }, context);
    expect(rowsFor()).toHaveLength(2);
    expect(rowsFor()[1].operation).toBe('UPDATE');
    await repo.softDelete('repo-sync-1', context);
    expect(rowsFor()).toHaveLength(3);
    expect(rowsFor()[2].operation).toBe('DELETE');
  });
});
