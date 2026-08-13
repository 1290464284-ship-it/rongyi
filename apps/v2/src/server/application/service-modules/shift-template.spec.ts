import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import type { AppContext } from '../../../domain/contracts';
import { ShiftTemplateService } from './shift-template';

describe('ShiftTemplateService validation and edge branches', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-06T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-shift-template-service-'));
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

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function createTemplate(input: Record<string, unknown>): void {
    db.prepare(
      `INSERT INTO ShiftTemplate (
         id, name, startTime, endTime, workDaysJson, color, active, clinicId,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      String(input.id),
      String(input.name ?? '模板'),
      String(input.startTime ?? '09:00'),
      String(input.endTime ?? '18:00'),
      input.workDaysJson === undefined ? '[1,2,3,4,5]' : String(input.workDaysJson),
      input.color === undefined ? null : input.color,
      input.active === false ? 0 : 1,
      context.clinicId,
      now,
      now,
    );
  }

  it('rejects non-string and blank template names on create', () => {
    const service = new ShiftTemplateService(db);
    expect(() => service.create({
      name: 123 as unknown as string,
      startTime: '09:00',
      endTime: '18:00',
    }, context)).toThrow('模板名称不能为空');
    expect(() => service.create({
      name: '   ',
      startTime: '09:00',
      endTime: '18:00',
    }, context)).toThrow('模板名称不能为空');
  });

  it('rejects invalid update names, time ranges, colors, and active values', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-edge' });
    expect(() => service.update('template-edge', { name: 7 as unknown as string }, context))
      .toThrow('模板名称不能为空');
    expect(() => service.update('template-edge', { startTime: '18:00', endTime: '09:00' }, context))
      .toThrow('结束时间必须晚于开始时间');
    const clearedColor = service.update('template-edge', { color: null }, context);
    expect(clearedColor.color).toBeNull();
    const disabled = service.update('template-edge', { active: false }, context);
    expect(disabled.active).toBe(0);
    expect(() => service.update('template-missing', { name: 'x' }, context))
      .toThrow('Shift template not found');
  });

  it('persists a null clinic id fallback and tolerates null work days JSON', () => {
    const service = new ShiftTemplateService(db);
    const withoutClinic = service.create({
      name: '无诊所模板',
      startTime: '08:00',
      endTime: '12:00',
    }, { ...context, clinicId: null });
    expect(withoutClinic.clinicId).toBeNull();

    db.prepare(
      `UPDATE ShiftTemplate SET workDaysJson = NULL, clinicId = NULL WHERE id = ?`,
    ).run(withoutClinic.id);
    const rows = service.list({ ...context, clinicId: null });
    expect(rows.find((row) => row.id === withoutClinic.id)?.workDays).toEqual([]);
  });

  it('rejects templates without work days at generate time', () => {
    createTemplate({ id: 'template-no-days', workDaysJson: '[]' });
    const service = new ShiftTemplateService(db);
    expect(() => service.generate({
      templateId: 'template-no-days',
      userId: 'user-admin-001',
      weekStart: '2026-08-03',
    }, context)).toThrow('模板未配置工作日，无法生成排班');
  });

  it('rejects invalid work day values during serialization', () => {
    const service = new ShiftTemplateService(db);
    expect(() => service.create({
      name: '坏工作日',
      startTime: '09:00',
      endTime: '18:00',
      workDaysJson: [0, 8],
    }, context)).toThrow('工作日必须为 1（周一）到 7（周日）的整数');
    expect(() => service.create({
      name: '坏工作日字符串',
      startTime: '09:00',
      endTime: '18:00',
      workDaysJson: 'not-json',
    }, context)).toThrow('工作日格式无效');
  });
});
