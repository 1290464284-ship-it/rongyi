/**
 * 微信提醒服务：每天为"该给谁发微信、发什么"生成人工跟进清单。
 *
 * 三个场景（scene）：
 * - APPOINTMENT_REMINDER 复诊提醒：预约日期 = 今天 + appointmentDaysBefore（默认提前 1 天）
 * - TREATMENT_RECALL 治疗后回访：就诊完成日期 = 今天 - recallDaysAfter（默认 3 天前）
 * - FIRST_EXAM_NUDGE 首诊跟进：首诊建档日期 = 今天 - firstExamDaysAfter（默认 3 天前）
 *
 * 生成幂等（同 clinicId+patientId+scene+scheduledDate+sourceId 只建一条 PENDING）。
 * 员工人工发微信后调用 markSent：提醒转 SENT 并同时写入 WechatMessage（status=SENT），
 * 供"微信发送"页留痕；不发的可 dismiss 忽略。
 *
 * 规则可用 Setting 键值覆盖（BOSS 在设置页维护）：
 *   wechatReminder.enabled / appointmentDaysBefore / recallDaysAfter / firstExamDaysAfter
 *   wechatReminder.appointmentContent / recallContent / firstExamContent
 * 话术占位符：{patientName} {appointmentTime} {days}
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { maskPhoneForExport } from './operations';
import { CLINIC_TZ_OFFSET_HOURS } from '../../../domain/contracts';
import type { AppContext } from '../../../domain/contracts';

type WechatReminderScene = 'APPOINTMENT_REMINDER' | 'TREATMENT_RECALL' | 'FIRST_EXAM_NUDGE';

const WECHAT_REMINDER_SCENE_LABELS: Record<WechatReminderScene, string> = {
  APPOINTMENT_REMINDER: '复诊提醒',
  TREATMENT_RECALL: '治疗后回访',
  FIRST_EXAM_NUDGE: '首诊跟进',
};

/** B-L8：同一诊所同一天的提醒生成结果 5 分钟内不重复扫描/插入（生成幂等的第二道闸）：
 *  高频轮询今日清单（如前端每 30s 刷新）不会反复跑三张大表扫描。 */
const TODAY_GENERATED_CACHE_TTL_MS = 5 * 60 * 1000;
/** 单日提醒列表上限；超过时通过 today() 的 truncated 标志显式暴露截断。 */
const WECHAT_REMINDER_LIMIT = 1000;

export interface WechatReminderConfig {
  enabled: boolean;
  appointmentDaysBefore: number;
  recallDaysAfter: number;
  firstExamDaysAfter: number;
  appointmentContent: string;
  recallContent: string;
  firstExamContent: string;
}

const DEFAULT_REMINDER_CONFIG: WechatReminderConfig = {
  enabled: true,
  appointmentDaysBefore: 1,
  recallDaysAfter: 3,
  firstExamDaysAfter: 3,
  appointmentContent: '{patientName}您好，您明天 {appointmentTime} 预约了复诊，请按时到诊；如需调整时间请提前联系诊所。',
  recallContent: '{patientName}您好，您上次治疗已过去 {days} 天，恢复情况怎么样？如有不适请及时联系我们。',
  firstExamContent: '{patientName}您好，上次您来诊所咨询后，不知道您考虑得怎么样了？如需进一步了解治疗方案，欢迎随时联系我们。',
};

const REMINDER_CONFIG_KEYS = [
  'wechatReminder.enabled',
  'wechatReminder.appointmentDaysBefore',
  'wechatReminder.recallDaysAfter',
  'wechatReminder.firstExamDaysAfter',
  'wechatReminder.appointmentContent',
  'wechatReminder.recallContent',
  'wechatReminder.firstExamContent',
] as const;

interface ReminderCandidate {
  sourceId: string;
  patientId: string;
  patientName: string | null;
  startTime?: string | null;
}

export interface WechatReminderItem {
  id: string;
  patientId: string;
  patientName: string | null;
  patientPhone: string | null;
  patientWechatId: string | null;
  scene: WechatReminderScene;
  sceneLabel: string;
  scheduledDate: string;
  sourceId: string | null;
  content: string;
  status: string;
}

function shiftDate(dateText: string, deltaDays: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function formatLocalTime(iso: string): string {
  // 诊所时区固定 +8h（与 SystemClock.clinicDate 一致）：直接用 UTC 偏移换算，
  // 避免依赖服务器本地时区导致同一预约在不同机器上显示不同时间（B-H3）。
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + CLINIC_TZ_OFFSET_HOURS * 3_600_000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function boundedDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return floored >= 0 && floored <= 365 ? floored : fallback;
}

export class WechatReminderService {
  /** B-L8：实例级生成缓存（clinicId:date → 最近生成时刻）。服务按单例注入，
   *  生产环境共享同一缓存；测试按用例新建实例则互不污染。 */
  private readonly todayGeneratedCache = new Map<string, { date: string; generatedAt: number }>();

  constructor(private readonly db: Database.Database) {}

  /** 清除今日生成缓存（测试隔离/规则变更后强制重新生成用）。 */
  clearTodayGeneratedCache(): void {
    this.todayGeneratedCache.clear();
  }

  config(context: AppContext): WechatReminderConfig {
    const rows = this.db.prepare(
      `SELECT key, value FROM Setting
       WHERE deletedAt IS NULL AND key IN (${REMINDER_CONFIG_KEYS.map(() => '?').join(', ')})${tenantAnd(context.clinicId)}`,
    ).all(...REMINDER_CONFIG_KEYS, ...tenantParams(context.clinicId)) as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));

    const config = { ...DEFAULT_REMINDER_CONFIG };
    config.enabled = values.get('wechatReminder.enabled') !== 'false';
    config.appointmentDaysBefore = boundedDays(values.get('wechatReminder.appointmentDaysBefore'), DEFAULT_REMINDER_CONFIG.appointmentDaysBefore);
    config.recallDaysAfter = boundedDays(values.get('wechatReminder.recallDaysAfter'), DEFAULT_REMINDER_CONFIG.recallDaysAfter);
    config.firstExamDaysAfter = boundedDays(values.get('wechatReminder.firstExamDaysAfter'), DEFAULT_REMINDER_CONFIG.firstExamDaysAfter);
    for (const key of ['appointmentContent', 'recallContent', 'firstExamContent'] as const) {
      const value = values.get(`wechatReminder.${key}`);
      if (value !== undefined && value.trim() !== '') config[key] = value;
    }
    return config;
  }

  updateConfig(
    input: Partial<Pick<WechatReminderConfig, 'enabled' | 'appointmentDaysBefore' | 'recallDaysAfter' | 'firstExamDaysAfter' | 'appointmentContent' | 'recallContent' | 'firstExamContent'>>,
    context: AppContext,
  ): WechatReminderConfig {
    const clinicId = context.clinicId;
    const now = context.now().toISOString();
    const findSetting = this.db.prepare(
      `SELECT id FROM Setting WHERE key = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    );
    const updateSetting = this.db.prepare(
      `UPDATE Setting SET value = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL`,
    );
    const insertSetting = this.db.prepare(
      `INSERT INTO Setting (id, clinicId, createdAt, updatedAt, deletedAt, key, value)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    );
    const writeSetting = (key: string, value: string): void => {
      const row = findSetting.get(key, ...tenantParams(clinicId)) as { id: string } | undefined;
      if (row) updateSetting.run(value, now, row.id);
      else insertSetting.run(randomUUID(), clinicId, now, now, key, value);
    };
    const run = this.db.transaction(() => {
      if (input.enabled !== undefined) {
        writeSetting('wechatReminder.enabled', input.enabled ? 'true' : 'false');
      }
      for (const [settingKey, field] of [
        ['wechatReminder.appointmentDaysBefore', 'appointmentDaysBefore'],
        ['wechatReminder.recallDaysAfter', 'recallDaysAfter'],
        ['wechatReminder.firstExamDaysAfter', 'firstExamDaysAfter'],
      ] as const) {
        const value = input[field];
        if (value === undefined) continue;
        if (!Number.isInteger(value) || value < 0 || value > 365) {
          throw new ValidationError(`${field} must be an integer between 0 and 365`);
        }
        writeSetting(settingKey, String(value));
      }
      for (const [settingKey, field] of [
        ['wechatReminder.appointmentContent', 'appointmentContent'],
        ['wechatReminder.recallContent', 'recallContent'],
        ['wechatReminder.firstExamContent', 'firstExamContent'],
      ] as const) {
        const value = input[field];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.length > 2000) {
          throw new ValidationError(`${field} must be a string up to 2000 characters`);
        }
        writeSetting(settingKey, value);
      }
    });
    run();
    this.todayGeneratedCache.clear();
    return this.config(context);
  }

  /** 返回今日清单；首次调用会按当前规则幂等生成当天的 PENDING 提醒（5 分钟 TTL 缓存生成标志）。 */
  today(context: AppContext): { date: string; config: WechatReminderConfig; items: WechatReminderItem[] } {
    const now = context.now();
    const today = new SystemClock().clinicDate(now);
    const config = this.config(context);
    if (config.enabled) {
      const cacheKey = `${context.clinicId ?? 'global'}:${today}`;
      const cached = this.todayGeneratedCache.get(cacheKey);
      const nowMs = Date.now();
      if (!cached || cached.date !== today || nowMs - cached.generatedAt >= TODAY_GENERATED_CACHE_TTL_MS) {
        this.generateDue(context, config, today);
        this.todayGeneratedCache.set(cacheKey, { date: today, generatedAt: nowMs });
      }
    }
    const pending = this.listPending(context, today);
    return { date: today, config, ...pending };
  }

  markSent(id: string, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const row = this.db.prepare(
      `SELECT * FROM WechatReminder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(id, ...tenantParams(clinicId)) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('Wechat reminder not found');
    if (row.status !== 'PENDING') throw new ConflictError('Wechat reminder is not pending');

    const now = context.now().toISOString();
    const messageId = randomUUID();
    const run = this.db.transaction(() => {
      const changes = this.db.prepare(
        `UPDATE WechatReminder SET status = 'SENT', sentAt = ?, sentBy = ?, updatedAt = ?
         WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL`,
      ).run(now, context.userId, now, id).changes;
      if (changes === 0) throw new ConflictError('Wechat reminder is not pending');
      this.db.prepare(
        `INSERT INTO WechatMessage (id, clinicId, createdAt, updatedAt, deletedAt, patientId, type, content, status, sentAt)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'SENT', ?)`,
      ).run(messageId, clinicId, now, now, row.patientId, String(row.scene), String(row.content ?? ''), now);
    });
    run();
    return { id, status: 'SENT', messageId };
  }

  dismiss(id: string, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const row = this.db.prepare(
      `SELECT id FROM WechatReminder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(id, ...tenantParams(clinicId)) as { id: string } | undefined;
    if (!row) throw new NotFoundError('Wechat reminder not found');
    const changes = this.db.prepare(
      `UPDATE WechatReminder SET status = 'DISMISSED', updatedAt = ?
       WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL`,
    ).run(context.now().toISOString(), id).changes;
    if (changes === 0) throw new ConflictError('Wechat reminder is not pending');
    return { id, status: 'DISMISSED' };
  }

  private generateDue(context: AppContext, config: WechatReminderConfig, today: string): void {
    const clinicId = context.clinicId;
    const now = context.now().toISOString();

    const appointmentDate = shiftDate(today, config.appointmentDaysBefore);
    const recallDate = shiftDate(today, -config.recallDaysAfter);
    const firstExamDate = shiftDate(today, -config.firstExamDaysAfter);

    const appointmentCandidates = this.db.prepare(
      `SELECT a.id AS sourceId, a.patientId, p.name AS patientName, a.startTime
       FROM Appointment a
       JOIN Patient p ON p.id = a.patientId AND p.deletedAt IS NULL
       WHERE a.deletedAt IS NULL AND substr(datetime(a.startTime, '+8 hours'), 1, 10) = ?
         AND a.status IN ('BOOKED', 'ARRIVED')${tenantAnd(clinicId, 'a.clinicId')}
       ORDER BY a.startTime ASC
       LIMIT ${WECHAT_REMINDER_LIMIT}`,
    ).all(appointmentDate, ...tenantParams(clinicId)) as ReminderCandidate[];

    const recallCandidates = this.db.prepare(
      `SELECT v.id AS sourceId, v.patientId, p.name AS patientName
       FROM Visit v
       JOIN Patient p ON p.id = v.patientId AND p.deletedAt IS NULL
       WHERE v.deletedAt IS NULL AND v.status = 'COMPLETED'
         AND substr(datetime(COALESCE(v.endTime, v.startTime), '+8 hours'), 1, 10) = ?${tenantAnd(clinicId, 'v.clinicId')}
       ORDER BY v.endTime ASC
       LIMIT ${WECHAT_REMINDER_LIMIT}`,
    ).all(recallDate, ...tenantParams(clinicId)) as ReminderCandidate[];

    const firstExamCandidates = this.db.prepare(
      `SELECT e.id AS sourceId, e.patientId, p.name AS patientName
       FROM FirstExam e
       JOIN Patient p ON p.id = e.patientId AND p.deletedAt IS NULL
       WHERE e.deletedAt IS NULL AND substr(datetime(e.createdAt, '+8 hours'), 1, 10) = ?
         AND (e.followUpStatus IS NULL OR e.followUpStatus IN ('NONE', 'PENDING'))${tenantAnd(clinicId, 'e.clinicId')}
       ORDER BY e.createdAt ASC
       LIMIT ${WECHAT_REMINDER_LIMIT}`,
    ).all(firstExamDate, ...tenantParams(clinicId)) as ReminderCandidate[];

    const insert = this.db.prepare(
      `INSERT INTO WechatReminder (id, clinicId, patientId, scene, scheduledDate, sourceId, content, status, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, NULL)`,
    );
    const exists = this.db.prepare(
      `SELECT 1 FROM WechatReminder
       WHERE patientId = ? AND scene = ? AND scheduledDate = ? AND sourceId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}
       LIMIT 1`,
    );

    const run = this.db.transaction(() => {
      for (const candidate of appointmentCandidates) {
        if (exists.get(candidate.patientId, 'APPOINTMENT_REMINDER', today, candidate.sourceId, ...tenantParams(clinicId))) continue;
        const content = config.appointmentContent
          .replaceAll('{patientName}', () => candidate.patientName ?? '')
          .replaceAll('{appointmentTime}', () => candidate.startTime ? formatLocalTime(candidate.startTime) : '');
        insert.run(randomUUID(), clinicId, candidate.patientId, 'APPOINTMENT_REMINDER', today, candidate.sourceId, content, now, now);
      }
      for (const candidate of recallCandidates) {
        if (exists.get(candidate.patientId, 'TREATMENT_RECALL', today, candidate.sourceId, ...tenantParams(clinicId))) continue;
        const content = config.recallContent
          .replaceAll('{patientName}', () => candidate.patientName ?? '')
          .replaceAll('{days}', () => String(config.recallDaysAfter));
        insert.run(randomUUID(), clinicId, candidate.patientId, 'TREATMENT_RECALL', today, candidate.sourceId, content, now, now);
      }
      for (const candidate of firstExamCandidates) {
        if (exists.get(candidate.patientId, 'FIRST_EXAM_NUDGE', today, candidate.sourceId, ...tenantParams(clinicId))) continue;
        const content = config.firstExamContent.replaceAll('{patientName}', () => candidate.patientName ?? '');
        insert.run(randomUUID(), clinicId, candidate.patientId, 'FIRST_EXAM_NUDGE', today, candidate.sourceId, content, now, now);
      }
    });
    run();
  }

  private listPending(context: AppContext, today: string): { items: WechatReminderItem[]; truncated: boolean } {
    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS total FROM WechatReminder r
       WHERE r.deletedAt IS NULL AND r.status = 'PENDING' AND r.scheduledDate = ?${tenantAnd(context.clinicId, 'r.clinicId')}`,
    ).get(today, ...tenantParams(context.clinicId)) as { total: number };
    const rows = this.db.prepare(
      `SELECT r.id, r.patientId, r.scene, r.scheduledDate, r.sourceId, r.content, r.status,
              p.name AS patientName, p.phone AS patientPhone, p.wechatId AS patientWechatId
       FROM WechatReminder r
       LEFT JOIN Patient p ON p.id = r.patientId AND p.deletedAt IS NULL
       WHERE r.deletedAt IS NULL AND r.status = 'PENDING' AND r.scheduledDate = ?${tenantAnd(context.clinicId, 'r.clinicId')}
       ORDER BY r.createdAt ASC
       LIMIT ${WECHAT_REMINDER_LIMIT}`,
    ).all(today, ...tenantParams(context.clinicId)) as Array<{
      id: string;
      patientId: string;
      scene: WechatReminderScene;
      scheduledDate: string;
      sourceId: string | null;
      content: string;
      status: string;
      patientName: string | null;
      patientPhone: string | null;
      patientWechatId: string | null;
    }>;
    return {
      items: rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      patientName: row.patientName,
      patientPhone: maskPhoneForExport(row.patientPhone),
      patientWechatId: row.patientWechatId,
      scene: row.scene,
      sceneLabel: WECHAT_REMINDER_SCENE_LABELS[row.scene] ?? row.scene,
      scheduledDate: row.scheduledDate,
      sourceId: row.sourceId,
      content: row.content,
      status: row.status,
      })),
      truncated: Number(totalRow.total) > WECHAT_REMINDER_LIMIT,
    };
  }
}
