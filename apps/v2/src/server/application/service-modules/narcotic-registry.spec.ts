import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { NarcoticRegistryService } from './narcotic-registry';

describe('NarcoticRegistryService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-narcotic-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(now),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function narcoticService(): NarcoticRegistryService {
    return new NarcoticRegistryService(db);
  }

  it('records and lists narcotic registry entries', () => {
    const created = narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      itemId: 'inventory-demo-001',
      batchNo: 'B-001',
      quantity: 2,
      unit: '支',
      usage: '术后镇痛',
      balanceBefore: 10,
      balanceAfter: 8,
      remark: '双人核对',
    }, context);
    expect(typeof created.id).toBe('string');

    const row = db.prepare('SELECT * FROM NarcoticRegistry WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
    expect(row.recordDate).toBe('2026-08-05');
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.pharmacistId).toBe('user-admin-001');
    expect(row.itemId).toBe('inventory-demo-001');
    expect(row.batchNo).toBe('B-001');
    expect(row.quantity).toBe(2);
    expect(row.balanceAfter).toBe(8);
    expect(row.clinicId).toBe('clinic-v2-001');

    const listed = narcoticService().narcoticList(context);
    const found = listed.items.find((entry) => entry.id === created.id);
    expect(found).toBeDefined();
    expect(found?.patientName).toBe('Demo Patient');
    expect(found?.itemName).toBe('Dental Material');
    expect(found?.doctorName).toBe('System Administrator');

    const filtered = narcoticService().narcoticList(context, { recordDate: '2026-08-05' });
    expect(filtered.items.map((entry) => entry.id)).toContain(created.id);
    const filteredOut = narcoticService().narcoticList(context, { recordDate: '2020-01-01' });
    expect(filteredOut.items.map((entry) => entry.id)).not.toContain(created.id);
  });

  it('rejects missing dates, unknown items, and negative quantities', () => {
    expect(() => narcoticService().recordNarcotic({
      recordDate: '  ',
      itemId: 'inventory-demo-001',
      quantity: 1,
    }, context)).toThrow(ValidationError);
    expect(() => narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      itemId: 'inventory-missing',
      quantity: 1,
    }, context)).toThrow(NotFoundError);
    expect(() => narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      itemId: 'inventory-demo-001',
      quantity: -1,
    }, context)).toThrow(ValidationError);
    expect(() => narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      itemId: 'inventory-demo-001',
      quantity: 1.5,
    }, context)).toThrow(ValidationError);
  });

  it('updates editable fields and preserves patientId/doctorId', () => {
    const created = narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      itemId: 'inventory-demo-001',
      batchNo: 'B-001',
      quantity: 2,
      usage: '术后镇痛',
      balanceBefore: 10,
      balanceAfter: 8,
      remark: '旧备注',
    }, context);
    const result = narcoticService().updateNarcotic(String(created.id), {
      recordDate: '2026-08-06',
      itemId: 'inventory-demo-001',
      batchNo: 'B-002',
      quantity: 3,
      usage: '',
      balanceBefore: 8,
      balanceAfter: 5,
      remark: '新备注',
    }, context);
    expect(result).toEqual({ id: String(created.id) });

    const row = db.prepare('SELECT * FROM NarcoticRegistry WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
    expect(row.recordDate).toBe('2026-08-06');
    expect(row.batchNo).toBe('B-002');
    expect(row.quantity).toBe(3);
    expect(row.usage).toBeNull(); // 空串 -> null
    expect(row.balanceBefore).toBe(8);
    expect(row.balanceAfter).toBe(5);
    expect(row.remark).toBe('新备注');
    // patientId/doctorId 保持不变
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.doctorId).toBe('user-admin-001');

    const listed = narcoticService().narcoticList(context);
    const found = listed.items.find((entry) => entry.id === created.id);
    expect(found?.batchNo).toBe('B-002');
  });

  it('rejects invalid update input and unknown records', () => {
    const created = narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      itemId: 'inventory-demo-001',
      quantity: 1,
    }, context);
    const base = { itemId: 'inventory-demo-001', quantity: 1 };
    expect(() => narcoticService().updateNarcotic(String(created.id), { ...base, recordDate: '  ' }, context)).toThrow(ValidationError);
    expect(() => narcoticService().updateNarcotic(String(created.id), { ...base, recordDate: '2026-08-05', quantity: -1 }, context)).toThrow(ValidationError);
    expect(() => narcoticService().updateNarcotic(String(created.id), { ...base, recordDate: '2026-08-05', quantity: 1.5 }, context)).toThrow(ValidationError);
    expect(() => narcoticService().updateNarcotic(String(created.id), { ...base, recordDate: '2026-08-05', itemId: 'inventory-missing' }, context)).toThrow(NotFoundError);
    expect(() => narcoticService().updateNarcotic('narcotic-missing', { ...base, recordDate: '2026-08-05' }, context)).toThrow(NotFoundError);
  });

  it('soft-deletes a narcotic record; missing record throws NotFoundError', () => {
    const created = narcoticService().recordNarcotic({
      recordDate: '2026-08-05',
      itemId: 'inventory-demo-001',
      quantity: 1,
    }, context);
    const result = narcoticService().deleteNarcotic(String(created.id), context);
    expect(result).toEqual({ id: String(created.id), deleted: true });

    const row = db.prepare('SELECT deletedAt FROM NarcoticRegistry WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
    expect(row.deletedAt).not.toBeNull();
    const listed = narcoticService().narcoticList(context);
    expect(listed.items.map((entry) => String(entry.id))).not.toContain(String(created.id));
    expect(() => narcoticService().deleteNarcotic('narcotic-missing', context)).toThrow(NotFoundError);
  });
});
