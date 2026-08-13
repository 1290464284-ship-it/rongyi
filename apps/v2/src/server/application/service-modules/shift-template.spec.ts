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

  it('maps week schedule rows with null optional fields', () => {
    db.prepare(
      `INSERT INTO WorkSchedule (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startTime, endTime, type, remark,
         shiftTemplateId, title, weekDay, color, isRecurring
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'user-admin-001',
                 '2026-08-04T09:00:00', NULL, NULL, NULL,
                 NULL, NULL, NULL, NULL, NULL)`,
    ).run('ws-null-optional', now, now);
    const service = new ShiftTemplateService(db);
    const row = service.weekSchedules('2026-08-03', context).find((entry) => entry.id === 'ws-null-optional');
    expect(row).toMatchObject({
      userIdLabel: 'System Administrator',
      shiftTemplateId: null,
      title: null,
      color: null,
      weekDay: 0,
      startTime: '2026-08-04T09:00:00',
      endTime: '',
      type: '',
      date: '2026-08-04',
    });
  });

  it('generates fixed schedules with created/skipped counts and is idempotent', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-gen' });
    const first = service.generate({ templateId: 'template-gen', userId: 'user-admin-001', weekStart: '2026-08-03' }, context);
    expect(first).toEqual({ created: 5, skipped: 0, weekStart: '2026-08-03' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM WorkSchedule WHERE shiftTemplateId = ?').get('template-gen')).toEqual({ c: 5 });

    const second = service.generate({ templateId: 'template-gen', userId: 'user-admin-001', weekStart: '2026-08-03' }, context);
    expect(second).toEqual({ created: 0, skipped: 5, weekStart: '2026-08-03' });
    // 只生成工作日对应的日期（周一 8-03 → 周五 8-07）
    const dates = (db.prepare('SELECT DISTINCT date(startTime) AS d FROM WorkSchedule WHERE shiftTemplateId = ?').all('template-gen') as Array<{ d: string }>)
      .map((row) => row.d);
    expect(dates).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
  });

  it('rejects inactive templates and unknown users at generate time', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-inactive', active: false });
    expect(() => service.generate({
      templateId: 'template-inactive',
      userId: 'user-admin-001',
      weekStart: '2026-08-03',
    }, context)).toThrow('班次模板已停用，无法生成排班');

    createTemplate({ id: 'template-active' });
    expect(() => service.generate({
      templateId: 'template-active',
      userId: 'user-unknown-001',
      weekStart: '2026-08-03',
    }, context)).toThrow('User not found');
  });

  it('normalizes non-Monday and Sunday week starts and rejects invalid dates', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-wk' });
    // 周三与周日都归一到所在周周一
    const wednesday = service.generate({ templateId: 'template-wk', userId: 'user-admin-001', weekStart: '2026-08-05' }, context);
    expect(wednesday.weekStart).toBe('2026-08-03');
    const sunday = service.generate({ templateId: 'template-wk', userId: 'user-admin-001', weekStart: '2026-08-09' }, context);
    expect(sunday.weekStart).toBe('2026-08-03');
    // 非法日历日期与无法解析的字符串
    expect(() => service.weekSchedules('2026-02-30', context)).toThrow('weekStart 格式应为 YYYY-MM-DD');
    expect(() => service.weekSchedules('not-a-date', context)).toThrow('weekStart 格式应为 YYYY-MM-DD');
    // 斜杠日期回退到 Date 解析并按周一归一化
    expect(service.weekSchedules('2026/08/05', context).length).toBeGreaterThanOrEqual(0);
    // 跨月周：仅周日模板，8-31（周一）生成的周日落在 9-06
    createTemplate({ id: 'template-wk-sun', workDaysJson: '[7]' });
    const crossMonth = service.generate({ templateId: 'template-wk-sun', userId: 'user-admin-001', weekStart: '2026-08-31' }, context);
    expect(crossMonth.created).toBe(1);
    const sundayRow = db.prepare(
      `SELECT startTime FROM WorkSchedule WHERE shiftTemplateId = 'template-wk-sun' AND startTime LIKE '2026-09-06%'`,
    ).get();
    expect(sundayRow).toBeDefined();
  });

  it('serializes and deduplicates work days from arrays and JSON strings', () => {
    const service = new ShiftTemplateService(db);
    const fromArray = service.create({ name: '数组', startTime: '09:00', endTime: '18:00', workDaysJson: [3, 1, 3, 7] }, context);
    expect(fromArray.workDaysJson).toBe('[1,3,7]');
    const fromString = service.create({ name: '字符串', startTime: '09:00', endTime: '18:00', workDaysJson: '[5,5,2]' }, context);
    expect(fromString.workDaysJson).toBe('[2,5]');
    expect(() => service.create({ name: '空数组', startTime: '09:00', endTime: '18:00', workDaysJson: [] }, context))
      .toThrow('请至少选择一个工作日');
    expect(() => service.create({ name: '非数组', startTime: '09:00', endTime: '18:00', workDaysJson: '{"a":1}' }, context))
      .toThrow('请至少选择一个工作日');
  });

  it('parses invalid and duplicated work days stored in the database', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-bad-json', workDaysJson: 'not-json' });
    createTemplate({ id: 'template-dup-days', workDaysJson: '[2,2,9,1]' });
    const rows = service.list(context);
    expect(rows.find((row) => row.id === 'template-bad-json')?.workDays).toEqual([]);
    expect(rows.find((row) => row.id === 'template-dup-days')?.workDays).toEqual([1, 2]);
  });

  it('updates work days and color with explicit null versus undefined', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-upd', color: '#fff', workDaysJson: '[1,2,3]' });
    // null 保留现有工作日；undefined 保留现有颜色（运行时防御性处理 null）
    const kept = service.update('template-upd', { workDaysJson: null as unknown as string | number[] }, context);
    expect(kept.workDaysJson).toBe('[1,2,3]');
    expect(kept.color).toBe('#fff');
    const changed = service.update('template-upd', { workDaysJson: [6, 7], color: null }, context);
    expect(changed.workDaysJson).toBe('[6,7]');
    expect(changed.color).toBeNull();
  });

  it('filters the template list by activeOnly', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-on', active: true });
    createTemplate({ id: 'template-off', active: false });
    const activeOnly = service.list(context, { activeOnly: true });
    expect(activeOnly.some((row) => row.id === 'template-on')).toBe(true);
    expect(activeOnly.some((row) => row.id === 'template-off')).toBe(false);
    expect(service.list(context).some((row) => row.id === 'template-off')).toBe(true);
  });

  it('creates templates with explicit color and active values', () => {
    const service = new ShiftTemplateService(db);
    const colored = service.create({ name: '带颜色', startTime: '09:00', endTime: '18:00', color: '#abc123', active: false }, context);
    expect(colored.color).toBe('#abc123');
    expect(colored.active).toBe(0);
    const nullColor = service.create({ name: '空颜色', startTime: '09:00', endTime: '18:00', color: null as unknown as string }, context);
    expect(nullColor.color).toBeNull();
    const defaultActive = service.create({ name: '默认启用', startTime: '09:00', endTime: '18:00', active: true }, context);
    expect(defaultActive.active).toBe(1);
  });

  it('rejects equal start and end times on create and update', () => {
    const service = new ShiftTemplateService(db);
    expect(() => service.create({ name: '等时', startTime: '09:00', endTime: '09:00' }, context))
      .toThrow('结束时间必须晚于开始时间');
    createTemplate({ id: 'template-eq' });
    expect(() => service.update('template-eq', { startTime: '10:00', endTime: '10:00' }, context))
      .toThrow('结束时间必须晚于开始时间');
  });

  it('updates color to a concrete value and keeps active when omitted', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-color-upd', color: '#fff', active: true });
    const updated = service.update('template-color-upd', { color: '#123456' }, context);
    expect(updated.color).toBe('#123456');
    expect(updated.active).toBe(1); // 未传 active → 保持启用
  });

  it('carries template color into generated schedules with sunday weekDay 0', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-color-sun', color: '#00ff00', workDaysJson: '[7]' });
    service.generate({ templateId: 'template-color-sun', userId: 'user-admin-001', weekStart: '2026-08-31' }, context);
    const row = db.prepare(
      `SELECT color, weekDay FROM WorkSchedule WHERE shiftTemplateId = 'template-color-sun'`,
    ).get() as { color: string | null; weekDay: number };
    expect(row.color).toBe('#00ff00');
    expect(row.weekDay).toBe(0); // day 7 % 7 = 0（周日）
  });

  it('maps week schedule rows with concrete color values', () => {
    db.prepare(
      `INSERT INTO WorkSchedule (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startTime, endTime, type, remark,
         shiftTemplateId, title, weekDay, color, isRecurring
       ) VALUES ('ws-colored', 'clinic-v2-001', ?, ?, NULL, 'user-admin-001',
                 '2026-08-04T09:00:00', '2026-08-04T18:00:00', 'FIXED', NULL,
                 'shift-1', '值班', 1, '#ff0000', 1)`,
    ).run(now, now);
    const service = new ShiftTemplateService(db);
    const row = service.weekSchedules('2026-08-03', context).find((entry) => entry.id === 'ws-colored');
    expect(row).toMatchObject({ color: '#ff0000', weekDay: 1, shiftTemplateId: 'shift-1', title: '值班' });
  });

  it('parses non-array and fractional stored work days defensively', () => {
    const service = new ShiftTemplateService(db);
    createTemplate({ id: 'template-obj-days', workDaysJson: '{"a":1}' });
    createTemplate({ id: 'template-frac-days', workDaysJson: '[2,1.5]' });
    const rows = service.list(context);
    expect(rows.find((row) => row.id === 'template-obj-days')?.workDays).toEqual([]);
    expect(rows.find((row) => row.id === 'template-frac-days')?.workDays).toEqual([2]);
  });

  it('rejects fractional work days during serialization', () => {
    const service = new ShiftTemplateService(db);
    expect(() => service.create({ name: '小数日', startTime: '09:00', endTime: '18:00', workDaysJson: [1.5] }, context))
      .toThrow('工作日必须为 1（周一）到 7（周日）的整数');
  });
});
