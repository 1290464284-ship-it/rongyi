// SyncService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { recordSyncChange } from '../../infrastructure/sync-change';
import { SyncService } from './sync';
import type { AppContext } from '../../../domain/contracts';

describe('SyncService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sync-'));
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

  it('pulls sync changes with a cursor across the 1000-row page', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-cursor-device', 'Cursor Test', context);
    // 起点取本库当前最新 createdAt +1ms：新语义下与游标同毫秒的行也会投递（防丢变更），
    // 必须跳过同毫秒的遗留行，确保后续插入的 1001 条是唯一可见的新变更。
    const maxRow = db.prepare('SELECT MAX(createdAt) AS m FROM SyncChange WHERE clinicId = ?').get(context.clinicId) as { m: string | null };
    const since = maxRow.m ? new Date(Date.parse(maxRow.m) + 1).toISOString() : new Date(0).toISOString();
    const createdAtFor = (index: number) => new Date(Date.parse(since) + index + 1).toISOString();
    try {
      for (let index = 0; index < 1001; index += 1) {
        const createdAt = createdAtFor(index);
        db.prepare(
          `INSERT INTO SyncChange (
             id, clinicId, createdAt, updatedAt, deletedAt,
             tableName, recordId, operation, deviceId
           ) VALUES (?, ?, ?, ?, NULL, 'Patient', ?, 'INSERT', 'other-device')`,
        ).run(`sync-cursor-change-${index}`, context.clinicId, createdAt, createdAt, `sync-cursor-record-${index}`);
      }

      const first = service.pull(since, 'sync-cursor-device', device.token, context);
      expect(first.changes).toHaveLength(1000);
      expect(first.changes[0].recordId).toBe('sync-cursor-record-0');
      expect(first.changes[999].recordId).toBe('sync-cursor-record-999');
      expect(first.cursor).toBe(`${createdAtFor(999)}|${first.changes[999].rowid}`);

      const second = service.pull(first.cursor, 'sync-cursor-device', device.token, context);
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0].recordId).toBe('sync-cursor-record-1000');
      expect(second.cursor).toBe(`${createdAtFor(1000)}|${second.changes[0].rowid}`);

      const empty = service.pull(second.cursor, 'sync-cursor-device', device.token, context);
      expect(empty.changes).toHaveLength(0);
      expect(empty.cursor).toBe(second.cursor);
    } finally {
      db.prepare('DELETE FROM SyncChange WHERE clinicId = ? AND recordId LIKE ?').run(context.clinicId, 'sync-cursor-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-cursor-device');
    }
  });

  it('does not lose sync changes sharing the same createdAt across the 1000-row page', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-tie-device', 'Tie Test', context);
    // 起点 = 当前最新 createdAt +1ms，所有新行共用该时间点：与游标同毫秒的遗留行
    // 已被排除，且该毫秒恰好没有旧数据，能精确验证同毫秒分页不丢行。
    const maxRow = db.prepare('SELECT MAX(createdAt) AS m FROM SyncChange WHERE clinicId = ?').get(context.clinicId) as { m: string | null };
    const since = maxRow.m ? new Date(Date.parse(maxRow.m) + 1).toISOString() : new Date(0).toISOString();
    const tieTime = since;
    try {
      // 1001 条变更共用同一 createdAt（同毫秒并列），且超出单页 LIMIT 1000。
      for (let index = 0; index < 1001; index += 1) {
        db.prepare(
          `INSERT INTO SyncChange (
             id, clinicId, createdAt, updatedAt, deletedAt,
             tableName, recordId, operation, deviceId
           ) VALUES (?, ?, ?, ?, NULL, 'Patient', ?, 'INSERT', 'other-device')`,
        ).run(`sync-tie-change-${index}`, context.clinicId, tieTime, tieTime, `sync-tie-record-${index}`);
      }

      const first = service.pull(since, 'sync-tie-device', device.token, context);
      expect(first.changes).toHaveLength(1000);
      const firstIds = new Set(first.changes.map((row) => String(row.recordId)));
      expect(firstIds.size).toBe(1000);

      const second = service.pull(first.cursor, 'sync-tie-device', device.token, context);
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0].recordId).toBe('sync-tie-record-1000');
      expect(second.cursor).toMatch(/^.+\.\d{3}Z\|\d+$/);

      const third = service.pull(second.cursor, 'sync-tie-device', device.token, context);
      expect(third.changes).toHaveLength(0);
      expect(third.cursor).toBe(second.cursor);
    } finally {
      db.prepare('DELETE FROM SyncChange WHERE clinicId = ? AND recordId LIKE ?').run(context.clinicId, 'sync-tie-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-tie-device');
    }
  });

  it('pushes sync changes in transactional batches and persists every row', async () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-push-batch-device', 'Push Batch', context);
    const changes = Array.from({ length: 300 }, (_, index) => ({
      tableName: 'Patient',
      recordId: `sync-push-batch-record-${index}`,
      operation: 'INSERT',
      updatedAt: new Date().toISOString(),
      data: {
        code: `SYNC-PUSH-BATCH-${index}`,
        name: `Sync Push Batch ${index}`,
        gender: 'UNKNOWN',
        phone: `13${String(400000000 + index)}`,
        source: 'OTHER',
        active: true,
      },
    }));
    try {
      const result = await service.push({
        deviceId: 'sync-push-batch-device',
        deviceToken: device.token,
        changes,
      }, context);
      expect(result.accepted).toBe(300);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);

      const patients = db.prepare('SELECT COUNT(*) AS n FROM Patient WHERE clinicId = ? AND id LIKE ?').get(context.clinicId, 'sync-push-batch-record-%') as { n: number };
      expect(Number(patients.n)).toBe(300);
      const changeLog = db.prepare('SELECT COUNT(*) AS n FROM SyncChange WHERE deviceId = ? AND recordId LIKE ?').get('sync-push-batch-device', 'sync-push-batch-record-%') as { n: number };
      expect(Number(changeLog.n)).toBe(300);
    } finally {
      db.prepare('DELETE FROM Patient WHERE clinicId = ? AND id LIKE ?').run(context.clinicId, 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SearchIndex WHERE resource = ? AND recordId LIKE ?').run('Patient', 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SyncChange WHERE deviceId = ? AND recordId LIKE ?').run('sync-push-batch-device', 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-push-batch-device');
    }
  });

  // ---- 边缘分支测试（自 services-edge.spec.ts 聚合文件迁移，相对顺序保留）----

  it('keeps sync pull scoped to the active clinic', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-isolation-device', 'Isolation', context);
    const afterNow = '2026-08-04T00:00:00.100Z';
    const otherClinic = 'clinic-v2-sync-other';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-SYNC-OTHER', 'Sync Other Clinic', 1)`,
    ).run(otherClinic, now, now);
    db.prepare(
      `INSERT INTO SyncChange (
         id, clinicId, createdAt, updatedAt, deletedAt,
         tableName, recordId, operation, deviceId
       ) VALUES ('sync-isolation-a', ?, ?, ?, NULL, 'Patient', 'patient-a', 'INSERT', 'other-device')`,
    ).run(context.clinicId, afterNow, afterNow);
    db.prepare(
      `INSERT INTO SyncChange (
         id, clinicId, createdAt, updatedAt, deletedAt,
         tableName, recordId, operation, deviceId
       ) VALUES ('sync-isolation-b', ?, ?, ?, NULL, 'Patient', 'patient-b', 'INSERT', 'other-device')`,
    ).run(otherClinic, afterNow, afterNow);

    const pulled = service.pull(now, 'sync-isolation-device', device.token, context);
    expect(pulled.changes.some((row) => row.id === 'sync-isolation-a')).toBe(true);
    expect(pulled.changes.some((row) => row.id === 'sync-isolation-b')).toBe(false);
  });

  it('provides a full resync snapshot scoped to the active clinic', () => {
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EXTRA-SYNC', 'Extra Sync Patient', 'UNKNOWN', '13900000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-extra-snapshot', context.clinicId, now, now);
    const service = new SyncService(db);
    const metadata = service.fullSnapshot(context);
    expect(metadata.tables?.Patient.total).toBeGreaterThanOrEqual(1);
    const page = service.fullSnapshot(context, { table: 'Patient', limit: 1, offset: 0 });
    expect(page.rows?.some((row) => row.id === 'patient-demo-001')).toBe(true);
    expect(page.truncated).toBe(true);
    const otherPage = service.fullSnapshot({ ...context, clinicId: 'clinic-v2-sync-other' }, { table: 'Patient' });
    expect(otherPage.rows?.some((row) => row.id === 'patient-demo-001')).toBe(false);
    expect(() => service.fullSnapshot(context, { table: 'NotATable' })).toThrow('Sync table is not allowed');
    expect(() => service.fullSnapshot({ ...context, role: 'DOCTOR' })).toThrow('Sync requires BOSS');
    const bounded = service.fullSnapshot(context, {
      table: 'Patient',
      limit: Number.POSITIVE_INFINITY,
      offset: Number.POSITIVE_INFINITY,
    });
    expect(Number.isFinite(bounded.limit)).toBe(true);
    expect(Number(bounded.limit)).toBeLessThanOrEqual(50_000);
    expect(Number.isFinite(bounded.offset)).toBe(true);
    const hugeOffset = service.fullSnapshot(context, { table: 'Patient', limit: 1, offset: 1e12 });
    expect(Number(hugeOffset.offset ?? 0)).toBeLessThanOrEqual(50_000);
    const first = service.fullSnapshot(context, { table: 'Patient', limit: 1 });
    const second = service.fullSnapshot(context, { table: 'Patient', limit: 1, afterId: String(first.nextId) });
    expect(second.offset).toBeUndefined();
    expect(second.rows?.[0]?.id).not.toBe(first.rows?.[0]?.id);
    const exactTotal = Math.max(1, Number(metadata.tables?.Patient.total ?? 0));
    const exact = service.fullSnapshot(context, { table: 'Patient', limit: exactTotal });
    expect(exact.truncated).toBe(false);
    expect(exact.nextId).toBeUndefined();
  });

  it('pulls server-originated changes to other devices and keeps push single-row', async () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-server-origin-device', 'Server Origin', context);
    const since = new Date(Date.now() - 60_000).toISOString();
    // 模拟 web/服务端本地直写产生的 server 变更。
    recordSyncChange(db, { tableName: 'Patient', recordId: 'patient-server-origin', operation: 'INSERT', clinicId: context.clinicId as string });
    const pulled = service.pull(since, 'sync-server-origin-device', device.token, context);
    expect(pulled.changes.some((c) => String(c.recordId) === 'patient-server-origin' && c.deviceId === 'server')).toBe(true);
    // push 保持单行且设备归属正确（repository 在 push 内不额外发射 server 行）。
    const pushed = await service.push({
      deviceId: 'sync-server-origin-device',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient', recordId: 'patient-pushed-single', operation: 'INSERT', updatedAt: new Date().toISOString(),
        data: { code: 'SYNC-SINGLE', name: 'Single', gender: 'UNKNOWN', phone: '13500000001', source: 'WALK_IN', active: true },
      }],
    }, context);
    expect(pushed.accepted).toBe(1);
    const rows = db.prepare(`SELECT deviceId, operation FROM SyncChange WHERE recordId = 'patient-pushed-single'`).all() as Array<{ deviceId: string; operation: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId: 'sync-server-origin-device', operation: 'INSERT' });
  });

  it('covers sync push error branches', async () => {
    const service = new SyncService(db);
    const freshIso = new Date(Date.now() + 60_000).toISOString();
    expect(() => service.pull(now, '', 'bad-token', context)).toThrow('Device credentials');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: 'bad-token',
      changes: [],
    }, context)).rejects.toThrow('not registered');
    expect(() => service.registerDevice('forbidden-device', 'x', { ...context, role: 'DOCTOR' }))
      .toThrow('Sync requires BOSS');
    expect(() => service.registerDevice('null-clinic-device', 'x', { ...context, clinicId: null }))
      .toThrow('Sync requires a clinic scope');
    const device = service.registerDevice('device-1', 'Edge Device', context);
    expect(() => service.pull(now, 'device-1', device.token, { ...context, clinicId: null }))
      .toThrow('Sync requires a clinic scope');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [],
    }, { ...context, clinicId: null })).rejects.toThrow('Sync requires a clinic scope');
    expect(() => service.pull(now, 'device-1', device.token, { ...context, role: 'DOCTOR' }))
      .toThrow('Sync requires BOSS');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [],
    }, { ...context, role: 'DOCTOR' })).rejects.toThrow('Sync requires BOSS');
    expect(service.pull(now, 'device-1', device.token, context)).toHaveProperty('changes');
    const notAllowed = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'NotAllowed', recordId: 'x', operation: 'INSERT', updatedAt: now, data: {} }],
    }, context);
    expect(notAllowed.failed).toBe(1);
    const missingData = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-1', operation: 'INSERT', updatedAt: now, data: undefined }],
    }, context);
    expect(missingData.failed).toBe(1);
    const badOperation = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-op', operation: 'UPSERT', updatedAt: now, data: {} }],
    }, context);
    expect(badOperation.failed).toBe(1);
    const chargeSync = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Charge', recordId: 'edge-sync-charge', operation: 'INSERT', updatedAt: now, data: {} }],
    }, context);
    expect(chargeSync.failed).toBe(1);
    // Charge 任何操作（含 DELETE）都禁止经 sync 写入，防绕过 cancel 状态机软删收费单
    const chargeDelete = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Charge', recordId: 'edge-sync-charge', operation: 'DELETE', updatedAt: now }],
    }, context);
    expect(chargeDelete.failed).toBe(1);
    expect(chargeDelete.errors[0].error).toBe('Charge writes are disabled in sync; use charge APIs');
    const deleteResult = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-2', operation: 'DELETE', updatedAt: now }],
    }, context);
    expect(deleteResult.failed).toBe(1);
    const updateResult = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-edge',
        operation: 'INSERT',
        updatedAt: now,
        data: { code: 'SYNC-EDGE', name: 'Sync Edge', gender: 'UNKNOWN', phone: '13600000002', source: 'OTHER', active: true },
      }],
    }, context);
    expect(updateResult.accepted).toBe(1);
    const updateAgain = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-edge',
        operation: 'INSERT',
        updatedAt: freshIso,
        data: { name: 'Sync Edge Updated' },
      }],
    }, context);
    expect(updateAgain.accepted).toBe(1);
    const deleteTarget = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-delete',
        operation: 'INSERT',
        updatedAt: now,
        data: { code: 'SYNC-DELETE', name: 'Sync Delete', gender: 'UNKNOWN', phone: '13600000005', source: 'OTHER', active: true },
      }],
    }, context);
    expect(deleteTarget.accepted).toBe(1);
    const deleteExisting = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'patient-sync-delete', operation: 'DELETE', updatedAt: freshIso }],
    }, context);
    expect(deleteExisting.accepted).toBe(1);
    const deletedRow = db.prepare('SELECT deletedAt FROM Patient WHERE id = ?').get('patient-sync-delete') as { deletedAt: string | null } | undefined;
    expect(deletedRow?.deletedAt).not.toBeNull();
    // 状态机资源不能经 sync 直写终态；INSERT 缺省状态时注入初始状态。
    const terminalTreatment = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-terminal',
        operation: 'INSERT',
        updatedAt: now,
        data: {
          patientId: 'patient-demo-001',
          doctorId: 'user-admin-001',
          code: 'T-SYNC-TERMINAL',
          name: 'Terminal',
          category: 'GENERAL',
          price: 100,
          quantity: 1,
          status: 'COMPLETED',
        },
      }],
    }, context);
    expect(terminalTreatment.failed).toBe(1);
    expect(terminalTreatment.errors[0].error).toContain('状态由服务端状态机管理');
    const defaultTreatment = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-default',
        operation: 'INSERT',
        updatedAt: now,
        data: {
          patientId: 'patient-demo-001',
          doctorId: 'user-admin-001',
          code: 'T-SYNC-DEFAULT',
          name: 'Default',
          category: 'GENERAL',
          price: 100,
          quantity: 1,
        },
      }],
    }, context);
    expect(defaultTreatment.accepted).toBe(1);
    expect((db.prepare('SELECT status FROM Treatment WHERE id = ?').get('edge-sync-treatment-default') as { status: string }).status)
      .toBe('PLANNED');
    const mismatchedUpdate = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-default',
        operation: 'UPDATE',
        updatedAt: freshIso,
        data: { status: 'COMPLETED' },
      }],
    }, context);
    expect(mismatchedUpdate.failed).toBe(1);
    const matchedUpdate = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-default',
        operation: 'UPDATE',
        updatedAt: freshIso,
        data: { name: 'Default Updated', status: 'PLANNED' },
      }],
    }, context);
    expect(matchedUpdate.accepted).toBe(1);
    const trickyData: Record<string, unknown> = {};
    Object.defineProperty(trickyData, 'code', {
      enumerable: true,
      get() {
        throw 'sync-string-error';
      },
    });
    const nonError = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-non-error',
        operation: 'INSERT',
        updatedAt: now,
        data: trickyData,
      }],
    }, context);
    expect(nonError.failed).toBe(1);
    expect(() => service.cleanup(now, { ...context, clinicId: null })).toThrow('Sync requires a clinic scope');
    expect(service.cleanup(now, context).deleted).toBeGreaterThanOrEqual(0);
  });
});
