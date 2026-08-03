import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AppLogger } from '../../../common/services/logger.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';
import { PAGINATION } from '../../../common/constants/pagination';
import { TableNames } from '../../../common/constants/table-names';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import { BusinessValidationException, BusinessConflictException } from '../../../common/errors/business-exception';
import { SubmitSurveyDto } from './dto/submit-survey.dto';

export const POSITIVE_KEYWORDS = [
  '专业', '耐心', '干净', '便宜', '快', '环境好', '无痛', '服务好',
  '细心', '负责', '友好', '舒适', '满意', '推荐', '值得', '方便',
  '技术好', '态度好', '效率高', '性价比高',
];

export const NEGATIVE_KEYWORDS = [
  '慢', '态度差', '贵', '不干净', '等候时间长', '疼', '推销', '不专业',
  '敷衍', '不耐烦', '脏乱', '排队久', '迟到', '误诊', '疼痛', '乱收费',
  '环境差', '技术差', '服务差', '效率低',
];

const COMMENT_SYNONYMS: Array<[RegExp | string, string]> = [
  [/等候时间太[\s\S]?/g, '等候时间长'],
  [/等太久|等了很久/g, '等候时间长'],
  [/疼痛/g, '疼'],
];

function normalizeComment(comment: string): string {
  let s = comment;
  for (const [from, to] of COMMENT_SYNONYMS) {
    s = s.replace(from, () => to);
  }
  return s;
}

export const NEGATIVE_KEYWORDS_SET = new Set(NEGATIVE_KEYWORDS);
export const POSITIVE_KEYWORDS_SET = new Set(POSITIVE_KEYWORDS);

export interface NpsCalcResult {
  totalResponses: number;
  promoters: number;
  detractors: number;
  passives: number;
  nps: number;
  avgRatingMedical: number | null;
  avgRatingService: number | null;
  avgRatingEnvironment: number | null;
  avgRatingPrice: number | null;
  avgRatingWait: number | null;
  negativeKeywordCount: Record<string, number>;
}

export interface TrendPoint {
  date: string;
  nps: number;
  totalResponses: number;
}

export interface DoctorRankItem {
  doctorId: string;
  doctorName: string | null;
  totalSurveys: number;
  promoters: number;
  detractors: number;
  passives: number;
  nps: number;
}

export interface DashboardResult {
  overallNps: NpsCalcResult;
  goodRate: number;
  badRate: number;
  topDoctors: DoctorRankItem[];
  topNegativeKeywords: Array<{ tag: string; count: number }>;
  trend30: TrendPoint[];
}

function round2(v: number | null): number | null {
  if (v == null || v == undefined) return null;
  return Math.round(v * 100) / 100;
}

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) return parsed.filter((x: unknown) => typeof x === 'string');
    return [];
  } catch {
    return [];
  }
}

@Injectable()
export class SatisfactionService {
  private readonly logger = new AppLogger(SatisfactionService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
    private auditLogService: AuditLogService,
  ) {}

  private matchKeywords(comment: string): { positive: string[]; negative: string[]; negativeCount: number } {
    const positive: string[] = [];
    const negative: string[] = [];
    const normalized = normalizeComment(comment);
    for (const kw of POSITIVE_KEYWORDS) {
      if (normalized.includes(kw)) positive.push(kw);
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (normalized.includes(kw)) negative.push(kw);
    }
    return { positive, negative, negativeCount: negative.length };
  }

  private buildDateRangeFilter(from?: string, to?: string, createdAtCol = 'createdAt'): { clause: string; values: unknown[] } {
    const clause: string[] = [];
    const values: unknown[] = [];
    if (from) {
      clause.push(`date(${createdAtCol}) >= date(?)`);
      values.push(from);
    }
    if (to) {
      clause.push(`date(${createdAtCol}) <= date(?)`);
      values.push(to);
    }
    return { clause: clause.length ? ` AND ${clause.join(' AND ')}` : '', values };
  }

  async submitSurvey(data: SubmitSurveyDto) {
    const enabled = await this.settingsService.getBoolean('aiSatisfactionEnabled', true);
    if (!enabled) {
      throw new BusinessValidationException('满意度评价系统已禁用');
    }

    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      throw new BusinessValidationException('缺少诊所上下文');
    }

    if (data.npsScore < 0 || data.npsScore > 10) {
      throw new BusinessValidationException('npsScore 必须在 0-10 之间');
    }
    const ratings: Array<{ key: string; val: number | undefined }> = [
      { key: 'ratingMedical', val: data.ratingMedical },
      { key: 'ratingService', val: data.ratingService },
      { key: 'ratingEnvironment', val: data.ratingEnvironment },
      { key: 'ratingPrice', val: data.ratingPrice },
      { key: 'ratingWait', val: data.ratingWait },
    ];
    for (const r of ratings) {
      if (r.val != undefined && (r.val < 1 || r.val > 5)) {
        throw new BusinessValidationException(`${r.key} 必须在 1-5 之间`);
      }
    }

    if (data.source) {
      const validSources = ['CLINIC', 'QR_CODE', 'SMS_LINK', 'FOLLOW_UP_CALL'];
      if (!validSources.includes(data.source)) {
        throw new BusinessValidationException(`source 必须是 ${validSources.join(',')} 之一`);
      }
    }

    if (data.visitId) {
      const existing = this.dbService.prepare(
        `SELECT id FROM ${TableNames.SATISFACTION_SURVEY} WHERE visitId = ? AND clinicId = ?`
      ).get(data.visitId, clinicId);
      if (existing) {
        throw new BusinessConflictException('该就诊已提交过满意度评价');
      }
    }

    const allTags: string[] = [...(data.tags || [])];
    let negativeMatchCount = 0;
    if (data.comment) {
      const matched = this.matchKeywords(data.comment);
      for (const t of [...matched.positive, ...matched.negative]) {
        if (!allTags.includes(t)) allTags.push(t);
      }
      negativeMatchCount = matched.negativeCount;
    }
    const tagsJson = JSON.stringify(allTags);
    const source = data.source || 'CLINIC';

    const thresholdStr = await this.settingsService.get('aiSatisfactionAutoAlertThresholdScore');
    const threshold = thresholdStr ? parseInt(thresholdStr, 10) : 6;
    const npsThreshold = isNaN(threshold) ? 6 : threshold;

    const hasLowRating = ratings.some(r => r.val != undefined && r.val <= 2);
    const isNegative = data.npsScore <= npsThreshold || hasLowRating || negativeMatchCount >= 2;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const reasons: string[] = [];
    if (data.npsScore <= npsThreshold) reasons.push(`nps=${data.npsScore}<=${npsThreshold}`);
    if (hasLowRating) {
      const low = ratings.filter(r => r.val != undefined && r.val <= 2).map(r => `${r.key}=${r.val}`);
      reasons.push(`低评分 ${low.join(',')}`);
    }
    if (negativeMatchCount >= 2) reasons.push(`负面关键词${negativeMatchCount}个`);
    const reasonStr = reasons.join('; ') || '负面评分';

    this.dbService.transaction((tx) => {
      tx.prepare(`
        INSERT INTO ${TableNames.SATISFACTION_SURVEY}
          (id, visitId, appointmentId, patientId, doctorId, npsScore,
           ratingMedical, ratingService, ratingEnvironment, ratingPrice, ratingWait,
           comment, tags, source, clinicId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.visitId ?? null,
        data.appointmentId ?? null,
        data.patientId,
        data.doctorId ?? null,
        data.npsScore,
        data.ratingMedical ?? null,
        data.ratingService ?? null,
        data.ratingEnvironment ?? null,
        data.ratingPrice ?? null,
        data.ratingWait ?? null,
        data.comment ?? null,
        tagsJson,
        source,
        clinicId,
        now,
      );

      this.auditLogService.logAudit(
        tx,
        AuditLogType.AUDIT_SATISFACTION_SUBMITTED,
        id,
        TableNames.SATISFACTION_SURVEY,
        clinicId,
        {
          afterData: {
            npsScore: data.npsScore,
            source,
            tags: allTags,
            hasNegative: isNegative,
          },
        },
      );

      if (isNegative) {
        const alertId = crypto.randomUUID();
        const _detail = JSON.stringify({
          surveyId: id,
          npsScore: data.npsScore,
          patientId: data.patientId,
          doctorId: data.doctorId,
          ratingMedical: data.ratingMedical,
          ratingService: data.ratingService,
          ratingEnvironment: data.ratingEnvironment,
          ratingPrice: data.ratingPrice,
          ratingWait: data.ratingWait,
          comment: data.comment,
          tags: allTags,
          reason: reasonStr,
        });
        tx.prepare(`
          INSERT INTO BusinessAlert
            (id, clinicId, alertType, severity, metricName, currentValue,
             baselineValue, deviationPercent, message, suggestion,
             acknowledged, occurredAt, createdAt, updatedAt)
          VALUES (?, ?, 'SATISFACTION_NEGATIVE', 'WARN', 'satisfaction_nps', ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(
          alertId, clinicId, data.npsScore, null, null,
          `满意度负面评价：${reasonStr}`, '及时跟进患者反馈，处理投诉，改进服务',
          now, now, now,
        );
      }
    });

    return { id, createdAt: now, tags: allTags, isNegative };
  }

  async listSurveys(params: {
    visitId?: string;
    patientId?: string;
    doctorId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { visitId, patientId, doctorId, from, to } = params;
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM;
    const clinicId = this.clinicContext.getClinicId();
    const { clause: _clinicClause, params: _clinicParams } = buildClinicFilter(clinicId);

    const conditions: string[] = [`s.clinicId = ?`];
    const values: unknown[] = [clinicId];

    if (visitId) { conditions.push(`s.visitId = ?`); values.push(visitId); }
    if (patientId) { conditions.push(`s.patientId = ?`); values.push(patientId); }
    if (doctorId) { conditions.push(`s.doctorId = ?`); values.push(doctorId); }

    const dateRange = this.buildDateRangeFilter(from, to, 's.createdAt');
    if (dateRange.clause) {
      conditions.push(dateRange.clause.slice(5));
      values.push(...dateRange.values);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) as total FROM ${TableNames.SATISFACTION_SURVEY} s ${whereSql}`;
    const totalRow = this.dbService.prepare(countSql).get(...values) as { total: number };
    const total = totalRow?.total ?? 0;

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT s.*, p.name as patientName, u.name as doctorName
      FROM ${TableNames.SATISFACTION_SURVEY} s
      LEFT JOIN Patient p ON p.id = s.patientId AND p.clinicId = s.clinicId
      LEFT JOIN User u ON u.id = s.doctorId AND u.clinicId = s.clinicId
      ${whereSql}
      ORDER BY s.createdAt DESC
      LIMIT ? OFFSET ?
    `;
    const items = this.dbService.prepare(listSql).all(...values, pageSize, offset);
    const processedItems = (items as Array<Record<string, unknown>>).map(it => ({
      ...it,
      tags: parseTags(it.tags as string | null),
    }));

    return { items: processedItems, total, page, pageSize };
  }

  private collectSurveys(options: { from?: string; to?: string; doctorId?: string }) {
    const { from, to, doctorId } = options;
    const clinicId = this.clinicContext.getClinicId();

    const conditions: string[] = [`clinicId = ?`];
    const values: unknown[] = [clinicId];

    if (doctorId) { conditions.push(`doctorId = ?`); values.push(doctorId); }
    const dateRange = this.buildDateRangeFilter(from, to, 'createdAt');
    if (dateRange.clause) {
      conditions.push(dateRange.clause.slice(5));
      values.push(...dateRange.values);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const sql = `SELECT * FROM ${TableNames.SATISFACTION_SURVEY} ${whereSql}`;
    return this.dbService.prepare(sql).all(...values) as Array<Record<string, unknown>>;
  }

  calcNps(options: { from?: string; to?: string; doctorId?: string } = {}): NpsCalcResult {
    const rows = this.collectSurveys(options);
    let promoters = 0, detractors = 0, passives = 0;
    const med: number[] = [], svc: number[] = [], env: number[] = [], price: number[] = [], wait: number[] = [];
    const negCount: Record<string, number> = {};

    for (const r of rows) {
      const score = r.npsScore as number;
      if (score >= 9) promoters++;
      else if (score <= 6) detractors++;
      else passives++;

      if (typeof r.ratingMedical === 'number') med.push(r.ratingMedical);
      if (typeof r.ratingService === 'number') svc.push(r.ratingService);
      if (typeof r.ratingEnvironment === 'number') env.push(r.ratingEnvironment);
      if (typeof r.ratingPrice === 'number') price.push(r.ratingPrice);
      if (typeof r.ratingWait === 'number') wait.push(r.ratingWait);

      const tags = parseTags(r.tags as string | null);
      for (const t of tags) {
        if (NEGATIVE_KEYWORDS_SET.has(t)) {
          negCount[t] = (negCount[t] || 0) + 1;
        }
      }
    }

    const totalResponses = rows.length;
    const nps = totalResponses === 0 ? 0 : ((promoters - detractors) / Math.max(1, totalResponses)) * 100;

    const avg = (arr: number[]): number | null => arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;

    const sortedNeg = Object.entries(negCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topNeg: Record<string, number> = {};
    for (const [k, v] of sortedNeg) topNeg[k] = v;

    return {
      totalResponses,
      promoters,
      detractors,
      passives,
      nps: round2(nps) ?? 0,
      avgRatingMedical: round2(avg(med)),
      avgRatingService: round2(avg(svc)),
      avgRatingEnvironment: round2(avg(env)),
      avgRatingPrice: round2(avg(price)),
      avgRatingWait: round2(avg(wait)),
      negativeKeywordCount: topNeg,
    };
  }

  async snapshotDaily(day?: string) {
    const enabled = await this.settingsService.getBoolean('aiSatisfactionEnabled', true);
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return { written: 0 };
    if (!enabled) return { written: 0 };

    const snapshotDate = day || new Date().toISOString().slice(0, 10);
    const result = this.calcNps({ from: snapshotDate, to: snapshotDate });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const upsertSql = `
      INSERT INTO ${TableNames.NPS_SNAPSHOT}
        (id, clinicId, snapshotDate, totalResponses, promoters, detractors, passives, nps,
         avgRatingMedical, avgRatingService, avgRatingEnvironment, avgRatingPrice, avgRatingWait,
         negativeKeywordCount, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(clinicId, snapshotDate) DO UPDATE SET
        totalResponses = excluded.totalResponses,
        promoters = excluded.promoters,
        detractors = excluded.detractors,
        passives = excluded.passives,
        nps = excluded.nps,
        avgRatingMedical = excluded.avgRatingMedical,
        avgRatingService = excluded.avgRatingService,
        avgRatingEnvironment = excluded.avgRatingEnvironment,
        avgRatingPrice = excluded.avgRatingPrice,
        avgRatingWait = excluded.avgRatingWait,
        negativeKeywordCount = excluded.negativeKeywordCount,
        createdAt = excluded.createdAt
    `;

    this.dbService.prepare(upsertSql).run(
      id, clinicId, snapshotDate,
      result.totalResponses, result.promoters, result.detractors, result.passives, result.nps,
      result.avgRatingMedical, result.avgRatingService, result.avgRatingEnvironment,
      result.avgRatingPrice, result.avgRatingWait,
      JSON.stringify(result.negativeKeywordCount), now,
    );

    return { written: 1, snapshotDate, nps: result.nps, totalResponses: result.totalResponses };
  }

  trend(days = 30): TrendPoint[] {
    const clinicId = this.clinicContext.getClinicId();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: TrendPoint[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const snapshot = this.dbService.prepare(
        `SELECT nps, totalResponses FROM ${TableNames.NPS_SNAPSHOT}
         WHERE clinicId = ? AND snapshotDate = ?`
      ).get(clinicId, dateStr) as { nps: number; totalResponses: number } | undefined;

      if (snapshot) {
        result.push({ date: dateStr, nps: snapshot.nps, totalResponses: snapshot.totalResponses });
      } else {
        const live = this.calcNps({ from: dateStr, to: dateStr });
        result.push({ date: dateStr, nps: live.nps, totalResponses: live.totalResponses });
      }
    }
    return result;
  }

  doctorRank(limit = 10): DoctorRankItem[] {
    const clinicId = this.clinicContext.getClinicId();
    const rows = this.dbService.prepare(`
      SELECT doctorId, npsScore, ratingMedical, ratingService, ratingEnvironment, ratingPrice, ratingWait, tags
      FROM ${TableNames.SATISFACTION_SURVEY}
      WHERE clinicId = ? AND doctorId IS NOT NULL
    `).all(clinicId) as Array<Record<string, unknown>>;

    const byDoctor = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows) {
      const did = r.doctorId as string;
      if (!byDoctor.has(did)) byDoctor.set(did, []);
      byDoctor.get(did)!.push(r);
    }

    const ranked: DoctorRankItem[] = [];
    for (const [doctorId, surveys] of byDoctor.entries()) {
      if (surveys.length < 5) continue;
      let p = 0, d = 0, pass = 0;
      for (const s of surveys) {
        const sc = s.npsScore as number;
        if (sc >= 9) p++;
        else if (sc <= 6) d++;
        else pass++;
      }
      const npsVal = ((p - d) / Math.max(1, surveys.length)) * 100;
      const nameRow = this.dbService.prepare(
        `SELECT name FROM User WHERE id = ? AND clinicId = ? AND deletedAt IS NULL`
      ).get(doctorId, clinicId) as { name: string | null } | undefined;
      ranked.push({
        doctorId,
        doctorName: nameRow?.name ?? null,
        totalSurveys: surveys.length,
        promoters: p,
        detractors: d,
        passives: pass,
        nps: round2(npsVal) ?? 0,
      });
    }

    ranked.sort((a, b) => b.nps - a.nps || b.totalSurveys - a.totalSurveys);
    return ranked.slice(0, limit);
  }

  dashboard(options: { days?: number } = {}): DashboardResult {
    const days = options.days ?? 30;
    const overall = this.calcNps();

    const goodRate = overall.totalResponses === 0 ? 0 : (overall.promoters / overall.totalResponses) * 100;
    const badRate = overall.totalResponses === 0 ? 0 : (overall.detractors / overall.totalResponses) * 100;

    const doctors = this.doctorRank(3);

    const topNeg = Object.entries(overall.negativeKeywordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const trend30 = this.trend(days);

    return {
      overallNps: overall,
      goodRate: round2(goodRate) ?? 0,
      badRate: round2(badRate) ?? 0,
      topDoctors: doctors,
      topNegativeKeywords: topNeg,
      trend30,
    };
  }
}
