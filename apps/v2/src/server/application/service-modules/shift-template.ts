/**
 * 班次模板 + 固定排班（排班中心）。
 *
 * - ShiftTemplate 存模板（HH:MM 文本时间 + workDaysJson 工作日，1=周一 … 7=周日）；
 * - generate 把模板落到指定周的每一天，写入 WorkSchedule（type='FIXED'、isRecurring=1、
 *   weekDay 采用 JS Date.getDay() 约定 0=周日 … 6=周六，weekDay = day % 7）；
 * - WorkSchedule.startTime/endTime 存本地时间字符串 `YYYY-MM-DDTHH:MM:00`（无时区后缀）：
 *   固定排班是诊所本地语义，避免 UTC 转换造成跨日错位与周过滤漏行（代码中无既有
 *   WorkSchedule 数据可参照，这是本模块的存储约定，与 Appointments 的 UTC ISO 不同）；
 * - 幂等：同 userId + templateId + weekDay + 日期 已存在则跳过，返回 created/skipped 计数。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { userBelongsToClinic } from './common';
import { isValidCalendarDate } from '../../http/validation';
import type { AppContext } from '../../../domain/contracts';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_WORK_DAYS = '[1,2,3,4,5]';

export interface ShiftTemplateRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workDaysJson: string | null;
  workDays: number[];
  color: string | null;
  active: number;
  clinicId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftTemplateCreateInput {
  name: string;
  startTime: string;
  endTime: string;
  workDaysJson?: string | number[];
  color?: string;
  active?: boolean;
}

export interface ShiftTemplateUpdateInput {
  name?: string;
  startTime?: string;
  endTime?: string;
  workDaysJson?: string | number[];
  color?: string | null;
  active?: boolean;
}

export interface GenerateInput {
  templateId: string;
  userId: string;
  weekStart: string;
}

export interface GenerateResult {
  created: number;
  skipped: number;
  weekStart: string;
}

export interface WeekScheduleRow {
  id: string;
  userId: string;
  userIdLabel: string;
  shiftTemplateId: string | null;
  title: string | null;
  color: string | null;
  weekDay: number;
  startTime: string;
  endTime: string;
  type: string;
  date: string;
}

export class ShiftTemplateService {
  constructor(private readonly db: Database.Database) {}

  /** 模板列表（软删排除 + 租户过滤），返回解析后的 workDays。 */
  list(context: AppContext, opts?: { activeOnly?: boolean }): ShiftTemplateRow[] {
    const conditions = ['deletedAt IS NULL'];
    if (opts?.activeOnly) conditions.push('active = 1');
    const rows = this.db.prepare(
      `SELECT * FROM ShiftTemplate
       WHERE ${conditions.join(' AND ')}${tenantAnd(context.clinicId)}
       ORDER BY active DESC, createdAt ASC`,
    ).all(...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    return rows.map(toTemplateRow);
  }

  /** 新建模板：校验名称/时间/工作日，INSERT 并返回完整行。 */
  create(input: ShiftTemplateCreateInput, context: AppContext): ShiftTemplateRow {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new ValidationError('模板名称不能为空');
    const startTime = validateTime(input.startTime, '开始时间');
    const endTime = validateTime(input.endTime, '结束时间');
    if (endTime <= startTime) throw new ValidationError('结束时间必须晚于开始时间');
    const workDaysJson = input.workDaysJson === undefined || input.workDaysJson === null
      ? DEFAULT_WORK_DAYS
      : serializeWorkDays(input.workDaysJson);
    const now = context.now().toISOString();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO ShiftTemplate (
         id, name, startTime, endTime, workDaysJson, color, active, clinicId,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id, name, startTime, endTime, workDaysJson,
      input.color === undefined || input.color === null ? null : String(input.color),
      input.active === false ? 0 : 1,
      context.clinicId ?? null, now, now,
    );
    return this.getById(id, context)!;
  }

  /** 更新模板：改名/时间/天数/颜色/启用停用；不存在抛 NotFoundError。 */
  update(id: string, patch: ShiftTemplateUpdateInput, context: AppContext): ShiftTemplateRow {
    const existing = this.getById(id, context);
    if (!existing) throw new NotFoundError('Shift template not found');
    const name = patch.name === undefined ? existing.name : (typeof patch.name === 'string' ? patch.name.trim() : '');
    if (!name) throw new ValidationError('模板名称不能为空');
    const startTime = patch.startTime === undefined ? existing.startTime : validateTime(patch.startTime, '开始时间');
    const endTime = patch.endTime === undefined ? existing.endTime : validateTime(patch.endTime, '结束时间');
    if (endTime <= startTime) throw new ValidationError('结束时间必须晚于开始时间');
    const workDaysJson = patch.workDaysJson === undefined || patch.workDaysJson === null
      ? existing.workDaysJson
      : serializeWorkDays(patch.workDaysJson);
    const color = patch.color === undefined ? existing.color : (patch.color ?? null);
    const active = patch.active === undefined ? Number(existing.active) : (patch.active ? 1 : 0);
    const now = context.now().toISOString();
    const updated = this.db.prepare(
      `UPDATE ShiftTemplate
       SET name = ?, startTime = ?, endTime = ?, workDaysJson = ?, color = ?, active = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(name, startTime, endTime, workDaysJson, color, active, now, id, ...tenantParams(context.clinicId));
    if (Number(updated.changes) === 0) throw new NotFoundError('Shift template not found');
    return this.getById(id, context)!;
  }

  /**
   * 固定排班生成：模板 → 指定周（weekStart 归一化到周一）的每一天。
   * 幂等：同 userId + templateId + weekDay + 日期 已存在则跳过。
   */
  generate(input: GenerateInput, context: AppContext): GenerateResult {
    const template = this.db.prepare(
      `SELECT * FROM ShiftTemplate WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.templateId, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!template) throw new NotFoundError('Shift template not found');
    if (Number(template.active) !== 1) throw new ConflictError('班次模板已停用，无法生成排班');

    if (!userBelongsToClinic(this.db, input.userId, context.clinicId)) {
      throw new NotFoundError('User not found');
    }

    const weekStart = normalizeWeekStart(input.weekStart);
    const workDays = parseWorkDays(template.workDaysJson as string | null | undefined);
    if (workDays.length === 0) throw new ValidationError('模板未配置工作日，无法生成排班');

    const now = context.now().toISOString();
    let created = 0;
    let skipped = 0;
    const run = this.db.transaction(() => {
      for (const day of workDays) {
        const date = addDays(weekStart, day - 1);
        const startTime = `${date}T${String(template.startTime)}:00`;
        const endTime = `${date}T${String(template.endTime)}:00`;
        const weekDay = day % 7;
        const existing = this.db.prepare(
          `SELECT 1 FROM WorkSchedule
           WHERE userId = ? AND shiftTemplateId = ? AND weekDay = ? AND startTime LIKE ?
             AND deletedAt IS NULL${tenantAnd(context.clinicId)}
           LIMIT 1`,
        ).get(input.userId, input.templateId, weekDay, `${date}%`, ...tenantParams(context.clinicId));
        if (existing) {
          skipped += 1;
          continue;
        }
        this.db.prepare(
          `INSERT INTO WorkSchedule (
             id, userId, startTime, endTime, type, remark, shiftTemplateId,
             title, weekDay, color, isRecurring, clinicId, createdAt, updatedAt, deletedAt
           ) VALUES (?, ?, ?, ?, 'FIXED', '固定排班', ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
        ).run(
          randomUUID(), input.userId, startTime, endTime,
          input.templateId, String(template.name), weekDay,
          template.color === null || template.color === undefined ? null : String(template.color),
          context.clinicId ?? null, now, now,
        );
        created += 1;
      }
    });
    run();
    return { created, skipped, weekStart };
  }

  /** 某周（周一..周日）排班列表，join 用户名称，供页面周视图。 */
  weekSchedules(weekStart: string, context: AppContext): WeekScheduleRow[] {
    const start = normalizeWeekStart(weekStart);
    const end = addDays(start, 7);
    const rows = this.db.prepare(
      `SELECT W.id, W.userId, W.shiftTemplateId, W.title, W.color, W.weekDay,
              W.startTime, W.endTime, W.type,
              COALESCE(U.name, U.username, W.userId) AS userIdLabel
       FROM WorkSchedule W
       LEFT JOIN User U ON U.id = W.userId AND U.deletedAt IS NULL
       WHERE W.deletedAt IS NULL AND W.startTime >= ? AND W.startTime < ?${tenantAnd(context.clinicId, 'W.clinicId')}
       ORDER BY W.startTime ASC, W.userId ASC`,
    ).all(start, end, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      // userIdLabel 由 COALESCE 保证非空
      userIdLabel: String(row.userIdLabel),
      shiftTemplateId: row.shiftTemplateId === null || row.shiftTemplateId === undefined ? null : String(row.shiftTemplateId),
      title: row.title === null || row.title === undefined ? null : String(row.title),
      color: row.color === null || row.color === undefined ? null : String(row.color),
      weekDay: Number(row.weekDay ?? 0),
      // startTime 由 WHERE startTime >= ? 过滤，恒非空
      startTime: String(row.startTime),
      endTime: String(row.endTime ?? ''),
      type: String(row.type ?? ''),
      date: String(row.startTime).slice(0, 10),
    }));
  }

  private getById(id: string, context: AppContext): ShiftTemplateRow | undefined {
    const row = this.db.prepare(
      `SELECT * FROM ShiftTemplate WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    return row ? toTemplateRow(row) : undefined;
  }
}

function toTemplateRow(row: Record<string, unknown>): ShiftTemplateRow {
  return {
    id: String(row.id),
    // name/startTime/endTime 为 NOT NULL 列（迁移 133）
    name: String(row.name),
    startTime: String(row.startTime),
    endTime: String(row.endTime),
    workDaysJson: row.workDaysJson === null || row.workDaysJson === undefined ? null : String(row.workDaysJson),
    workDays: parseWorkDays(row.workDaysJson as string | null | undefined),
    color: row.color === null || row.color === undefined ? null : String(row.color),
    active: Number(row.active ?? 1),
    clinicId: row.clinicId === null || row.clinicId === undefined ? null : String(row.clinicId),
    // createdAt/updatedAt 在迁移后的表中为 NOT NULL
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/** 解析 workDaysJson 为 1..7 的升序去重整数数组；非法/缺失返回 []。 */
function parseWorkDays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const days = parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    return [...new Set(days)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function serializeWorkDays(value: string | number[]): string {
  let days: unknown;
  if (typeof value === 'string') {
    try {
      days = JSON.parse(value);
    } catch {
      throw new ValidationError('工作日格式无效');
    }
  } else {
    days = value;
  }
  if (!Array.isArray(days) || days.length === 0) throw new ValidationError('请至少选择一个工作日');
  const normalized = days.map(Number);
  for (const n of normalized) {
    if (!Number.isInteger(n) || n < 1 || n > 7) throw new ValidationError('工作日必须为 1（周一）到 7（周日）的整数');
  }
  return JSON.stringify([...new Set(normalized)].sort((a, b) => a - b));
}

function validateTime(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!TIME_RE.test(text)) throw new ValidationError(`${label}格式应为 HH:MM（24 小时制）`);
  return text;
}

/** 归一化到所在周的周一（本地日期语义），返回 'YYYY-MM-DD'。 */
function normalizeWeekStart(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const match = DATE_RE.exec(trimmed);
  let date: Date;
  if (match) {
    if (!isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
      throw new ValidationError('weekStart 格式应为 YYYY-MM-DD');
    }
    date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  } else {
    date = new Date(trimmed);
  }
  if (Number.isNaN(date.getTime())) throw new ValidationError('weekStart 格式应为 YYYY-MM-DD');
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
}

function addDays(dateStr: string, days: number): string {
  const match = DATE_RE.exec(dateStr);
  /* v8 ignore next -- 调用方均已通过 normalizeWeekStart 归一化，日期格式恒有效 */
  if (!match) throw new ValidationError('日期格式无效');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  return formatLocalDate(date);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
