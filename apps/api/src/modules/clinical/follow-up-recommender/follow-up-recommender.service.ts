 
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { AppLogger } from '../../../common/services/logger.service';
import { SettingsService } from '../../system/settings/settings.service';

export interface FollowUpTemplateEntity {
  id: string;
  name: string;
  triggerTreatmentCodes: string;
  triggerTreatmentCategories: string;
  minIntervalDays: number;
  recommendedIntervalDays: number;
  maxIntervalDays: number;
  riskMultiplierLow: number;
  riskMultiplierMedium: number;
  riskMultiplierHigh: number;
  riskMultiplierExtreme: number;
  requiresAdherenceCheck: number;
  clinicId: string;
  createdAt: string;
}

export interface FollowUpAssignmentEntity {
  id: string;
  patientId: string;
  followUpId?: string;
  templateId?: string;
  recommendedDate?: string;
  actualDate?: string;
  reason?: string;
  confidence: number;
  createdBy?: string;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AdherenceResult {
  score: number;
  pastDueCount: number;
  onTimeCount: number;
  avgDelayDays: number;
}

export interface FollowUpRecommendResult {
  templateId: string;
  templateName: string;
  recommendedDate: string;
  reason: string;
  confidence: number;
  _treatment?: { code: string; name: string; category: string };
  _template?: FollowUpTemplateEntity;
}

export interface ApplyResult {
  followUpId: string;
  assignmentId: string;
  patientId: string;
  recommendedDate: string;
}

export interface BatchGenerateResult {
  totalProcessed: number;
  totalGenerated: number;
  skippedDueToExisting: number;
}

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.floor((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000));
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

interface TemplateSeed {
  name: string;
  triggerTreatmentCategories: string[];
  triggerTreatmentCodes?: string[];
  minIntervalDays: number;
  recommendedIntervalDays: number;
  maxIntervalDays: number;
  riskMultiplierLow: number;
  riskMultiplierMedium: number;
  riskMultiplierHigh: number;
  riskMultiplierExtreme: number;
  requiresAdherenceCheck: 0 | 1;
}

const STANDARD_TEMPLATES: TemplateSeed[] = [
  { name: '根管治疗第1次复查（2周）', triggerTreatmentCategories: ['ENDODONTIC'], triggerTreatmentCodes: ['RCT-001'], minIntervalDays: 3, recommendedIntervalDays: 14, maxIntervalDays: 60, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '根管治疗第2次复查（3月冠修复）', triggerTreatmentCategories: ['ENDODONTIC'], triggerTreatmentCodes: ['RCT-001'], minIntervalDays: 30, recommendedIntervalDays: 90, maxIntervalDays: 180, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '洁牙复查（半年）', triggerTreatmentCategories: ['SCALING'], triggerTreatmentCodes: ['SCALE-001'], minIntervalDays: 30, recommendedIntervalDays: 180, maxIntervalDays: 365, riskMultiplierLow: 1.5, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.6, riskMultiplierExtreme: 0.4, requiresAdherenceCheck: 1 },
  { name: '牙周基础治疗复查（45天）', triggerTreatmentCategories: ['PERIODONTAL'], triggerTreatmentCodes: ['PERIO-001'], minIntervalDays: 14, recommendedIntervalDays: 45, maxIntervalDays: 90, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '种植复查1（30天）', triggerTreatmentCategories: ['IMPLANT'], triggerTreatmentCodes: ['IMPLANT-001'], minIntervalDays: 7, recommendedIntervalDays: 30, maxIntervalDays: 60, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '种植复查2（90天）', triggerTreatmentCategories: ['IMPLANT'], triggerTreatmentCodes: ['IMPLANT-001'], minIntervalDays: 45, recommendedIntervalDays: 90, maxIntervalDays: 120, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '种植复查3（180天）', triggerTreatmentCategories: ['IMPLANT'], triggerTreatmentCodes: ['IMPLANT-001'], minIntervalDays: 120, recommendedIntervalDays: 180, maxIntervalDays: 240, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '种植复查4（365天）', triggerTreatmentCategories: ['IMPLANT'], triggerTreatmentCodes: ['IMPLANT-001'], minIntervalDays: 270, recommendedIntervalDays: 365, maxIntervalDays: 450, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 1 },
  { name: '充填术后复查（半年）', triggerTreatmentCategories: ['FILLING'], triggerTreatmentCodes: ['FILL-001'], minIntervalDays: 30, recommendedIntervalDays: 180, maxIntervalDays: 270, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.6, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 0 },
  { name: '拔牙拆线复查（7天）', triggerTreatmentCategories: ['EXTRACTION'], triggerTreatmentCodes: ['EXTRACT-001'], minIntervalDays: 3, recommendedIntervalDays: 7, maxIntervalDays: 14, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.9, riskMultiplierExtreme: 0.8, requiresAdherenceCheck: 0 },
  { name: '拔牙术后复查（30天）', triggerTreatmentCategories: ['EXTRACTION'], triggerTreatmentCodes: ['EXTRACT-001'], minIntervalDays: 14, recommendedIntervalDays: 30, maxIntervalDays: 60, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.7, requiresAdherenceCheck: 1 },
  { name: '冠桥复查1（14天调颌）', triggerTreatmentCategories: ['CROWN_BRIDGE'], triggerTreatmentCodes: ['CROWN-001'], minIntervalDays: 7, recommendedIntervalDays: 14, maxIntervalDays: 30, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.7, requiresAdherenceCheck: 0 },
  { name: '冠桥复查2（半年）', triggerTreatmentCategories: ['CROWN_BRIDGE'], triggerTreatmentCodes: ['CROWN-001'], minIntervalDays: 90, recommendedIntervalDays: 180, maxIntervalDays: 270, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.7, requiresAdherenceCheck: 1 },
  { name: '正畸常规复查（每3~4周）', triggerTreatmentCategories: ['ORTHODONTIC'], triggerTreatmentCodes: ['ORTHO-001'], minIntervalDays: 14, recommendedIntervalDays: 25, maxIntervalDays: 45, riskMultiplierLow: 1.2, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.9, riskMultiplierExtreme: 0.8, requiresAdherenceCheck: 1 },
  { name: '儿牙防龋涂氟（每季度）', triggerTreatmentCategories: ['PEDO'], triggerTreatmentCodes: ['PEDO-FLUORIDE'], minIntervalDays: 45, recommendedIntervalDays: 90, maxIntervalDays: 120, riskMultiplierLow: 1.2, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.7, riskMultiplierExtreme: 0.5, requiresAdherenceCheck: 0 },
  { name: '常规年度检查（1年）', triggerTreatmentCategories: ['EXAM'], triggerTreatmentCodes: ['EXAM-001'], minIntervalDays: 180, recommendedIntervalDays: 365, maxIntervalDays: 450, riskMultiplierLow: 1.2, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.6, requiresAdherenceCheck: 1 },
  { name: '外科术后复查1（3天）', triggerTreatmentCategories: ['SURGERY'], triggerTreatmentCodes: ['SURG-001'], minIntervalDays: 1, recommendedIntervalDays: 3, maxIntervalDays: 7, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.6, requiresAdherenceCheck: 0 },
  { name: '外科术后复查2（7天）', triggerTreatmentCategories: ['SURGERY'], triggerTreatmentCodes: ['SURG-001'], minIntervalDays: 5, recommendedIntervalDays: 7, maxIntervalDays: 14, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.6, requiresAdherenceCheck: 1 },
  { name: '外科术后复查3（14天）', triggerTreatmentCategories: ['SURGERY'], triggerTreatmentCodes: ['SURG-001'], minIntervalDays: 10, recommendedIntervalDays: 14, maxIntervalDays: 30, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.6, requiresAdherenceCheck: 1 },
  { name: '外科术后复查4（30天）', triggerTreatmentCategories: ['SURGERY'], triggerTreatmentCodes: ['SURG-001'], minIntervalDays: 21, recommendedIntervalDays: 30, maxIntervalDays: 60, riskMultiplierLow: 1.0, riskMultiplierMedium: 1.0, riskMultiplierHigh: 0.8, riskMultiplierExtreme: 0.6, requiresAdherenceCheck: 1 },
];

@Injectable()
export class FollowUpRecommenderService extends BaseService<FollowUpTemplateEntity> {
  protected readonly logger = new AppLogger(FollowUpRecommenderService.name);

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private readonly settingsService: SettingsService,
  ) {
    super(dbService, clinicContext, { tableName: 'FollowUpTemplate' });
  }

  async seedTemplatesIfEmpty(): Promise<void> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return;

    const existingNames = (this.dbService.prepare(
      'SELECT name FROM FollowUpTemplate WHERE clinicId = ?',
    ).all(clinicId) as Array<{ name: string }>).map(r => r.name);

    const missing = STANDARD_TEMPLATES.filter(t => !existingNames.includes(t.name));
    if (missing.length === 0) return;

    const now = new Date().toISOString();
    const insertSql = `INSERT INTO FollowUpTemplate (
        id, name, triggerTreatmentCodes, triggerTreatmentCategories,
        minIntervalDays, recommendedIntervalDays, maxIntervalDays,
        riskMultiplierLow, riskMultiplierMedium, riskMultiplierHigh, riskMultiplierExtreme,
        requiresAdherenceCheck, clinicId, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    this.dbService.transaction((db) => {
      for (const t of missing) {
        const id = crypto.randomUUID();
        db.prepare(insertSql).run(
          id,
          t.name,
          JSON.stringify(t.triggerTreatmentCodes ?? []),
          JSON.stringify(t.triggerTreatmentCategories),
          t.minIntervalDays,
          t.recommendedIntervalDays,
          t.maxIntervalDays,
          t.riskMultiplierLow,
          t.riskMultiplierMedium,
          t.riskMultiplierHigh,
          t.riskMultiplierExtreme,
          t.requiresAdherenceCheck,
          clinicId,
          now,
        );
      }
    });
  }

  async computeAdherence(patientId: string): Promise<AdherenceResult> {
    const today = new Date().toISOString().slice(0, 10);
    const twelveMonthsAgo = addDays(today, -365);
    const { clause, params } = this.buildClinicClause();

    const rows = this.dbService.prepare(
      `SELECT status, planDate, completedAt FROM FollowUp
       WHERE patientId = ? AND planDate >= ? AND deletedAt IS NULL${clause}`,
    ).all(patientId, twelveMonthsAgo, ...params) as Array<{
      status: string;
      planDate: string;
      completedAt?: string;
    }>;

    let onTimeCount = 0;
    let pastDueCount = 0;
    const delays: number[] = [];

    for (const r of rows) {
      if (r.status === 'COMPLETED') {
        onTimeCount++;
        const completed = (r.completedAt ?? today).slice(0, 10);
        const diff = diffDays(r.planDate, completed);
        if (diff > 0) delays.push(diff);
      } else if (r.status === 'PENDING' || r.status === 'IN_PROGRESS') {
        const overdueDays = diffDays(r.planDate, today);
        if (overdueDays > 10) {
          pastDueCount++;
          delays.push(overdueDays);
        }
      }
    }

    const avgDelayDays = delays.length > 0
      ? delays.reduce((s, d) => s + d, 0) / delays.length
      : 0;

    const score = onTimeCount / (onTimeCount + pastDueCount + 1);
    const clamped = Math.max(0, Math.min(1, score));

    return { score: clamped, pastDueCount, onTimeCount, avgDelayDays };
  }

  private getMaxRiskLevel(
    cariesLevel: RiskLevel | undefined | null,
    periodontalLevel: RiskLevel | undefined | null,
    implantLevel: RiskLevel | undefined | null,
  ): RiskLevel {
    const levels: RiskLevel[] = [];
    if (cariesLevel) levels.push(cariesLevel);
    if (periodontalLevel) levels.push(periodontalLevel);
    if (implantLevel) levels.push(implantLevel);
    if (levels.length === 0) return 'MEDIUM';
    return levels.reduce((max, l) => RISK_ORDER[l] > RISK_ORDER[max] ? l : max, 'LOW');
  }

  private getRiskMultiplier(t: FollowUpTemplateEntity, level: RiskLevel): number {
    switch (level) {
      case 'LOW': return t.riskMultiplierLow ?? 1.0;
      case 'MEDIUM': return t.riskMultiplierMedium ?? 1.0;
      case 'HIGH': return t.riskMultiplierHigh ?? 0.75;
      case 'EXTREME': return t.riskMultiplierExtreme ?? 0.5;
    }
  }

  async recommendForVisit(visitId: string): Promise<FollowUpRecommendResult[]> {
    const enabled = await this.settingsService.get('aiFollowUpRecommendEnabled');
    if (enabled === 'false') return [];

    const { clause, params } = this.buildClinicClause();
    const clinicId = this.clinicContext.getClinicId();

    const visit = this.dbService.prepare(
      `SELECT id, patientId FROM Visit WHERE id = ?${clause}`,
    ).get(visitId, ...params) as { id: string; patientId: string } | undefined;
    if (!visit) return [];

    await this.seedTemplatesIfEmpty();

    const treatments = this.dbService.prepare(
      `SELECT code, name, category, completedDate FROM Treatment
       WHERE visitId = ? AND status = 'COMPLETED'${clause}
       ORDER BY COALESCE(completedDate, createdAt) DESC`,
    ).all(visitId, ...params) as Array<{
      code: string; name: string; category: string; completedDate?: string;
    }>;
    if (treatments.length === 0) return [];

    const templates = this.dbService.prepare(
      `SELECT * FROM FollowUpTemplate WHERE clinicId = ?`,
    ).all(clinicId) as FollowUpTemplateEntity[];
    if (templates.length === 0) return [];

    const patientId = visit.patientId;
    const adherence = await this.computeAdherence(patientId);
    const adherenceFactor = 1 + Math.pow(1 - adherence.score, 2);

    const riskRow = this.dbService.prepare(
      `SELECT cariesLevel, periodontalLevel, implantLevel FROM PatientRiskScore
       WHERE patientId = ?${clause} AND deletedAt IS NULL
       ORDER BY updatedAt DESC LIMIT 1`,
    ).get(patientId, ...params) as {
      cariesLevel?: RiskLevel; periodontalLevel?: RiskLevel; implantLevel?: RiskLevel;
    } | undefined;

    const maxRisk = this.getMaxRiskLevel(
      riskRow?.cariesLevel ?? null,
      riskRow?.periodontalLevel ?? null,
      riskRow?.implantLevel ?? null,
    );

    const today = new Date().toISOString().slice(0, 10);
    const results: FollowUpRecommendResult[] = [];
    const seenKey = new Set<string>();

    for (const tr of treatments) {
      for (const tpl of templates) {
        const codeList: string[] = safeParseJson(tpl.triggerTreatmentCodes, []);
        const catList: string[] = safeParseJson(tpl.triggerTreatmentCategories, []);
        const codeHit = codeList.includes(tr.code);
        const catHit = catList.includes(tr.category);
        if (!codeHit && !catHit) continue;

        const riskMultiplier = this.getRiskMultiplier(tpl, maxRisk);
        const rawDays = tpl.recommendedIntervalDays * riskMultiplier * adherenceFactor;
        let days = Math.round(rawDays);
        days = Math.max(days, tpl.minIntervalDays);
        days = Math.min(days, tpl.maxIntervalDays);

        const baseDate = tr.completedDate?.slice(0, 10) ?? today;
        const recommendedDate = addDays(baseDate, days);

        const dedupKey = `${patientId}|${tpl.id}|${recommendedDate}`;
        if (seenKey.has(dedupKey)) continue;
        seenKey.add(dedupKey);

        const reason = `${tr.name} #${tr.code} 完成后 ${maxRisk} 风险，` +
          `建议 ${tpl.recommendedIntervalDays}*${riskMultiplier.toFixed(2)}=${Math.round(tpl.recommendedIntervalDays * riskMultiplier)} 天后复查；` +
          `依从性 ${adherence.score.toFixed(2)}，已调整`;

        let confidence = 0.5;
        confidence += codeHit ? 0.25 : 0.15;
        confidence += catHit ? 0.15 : 0.05;
        confidence -= (1 - adherence.score) * 0.1;
        if (tpl.requiresAdherenceCheck && adherence.score < 0.5) confidence -= 0.1;
        confidence = Math.max(0.01, Math.min(0.99, confidence));

        results.push({
          templateId: tpl.id,
          templateName: tpl.name,
          recommendedDate,
          reason,
          confidence,
          _treatment: { code: tr.code, name: tr.name, category: tr.category },
          _template: tpl,
        });
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  async applyRecommendations(
    recommendations: FollowUpRecommendResult[],
    options: { assigneeId?: string; visitId?: string } = {},
  ): Promise<ApplyResult[]> {
    if (!recommendations || recommendations.length === 0) return [];

    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return [];

    const now = new Date().toISOString();
    const created: ApplyResult[] = [];

    this.dbService.transaction((db) => {
      for (const rec of recommendations) {
        const patientId = (rec as unknown as { patientId?: string }).patientId
          ?? this.resolvePatientIdFromRec(rec, db);
        if (!patientId) continue;

        const existDup = db.prepare(
          `SELECT id FROM FollowUp
           WHERE patientId = ? AND templateId = ? AND planDate = ? AND status = 'PENDING' AND deletedAt IS NULL`,
        ).get(patientId, rec.templateId, rec.recommendedDate) as { id: string } | undefined;
        if (existDup) continue;

        const followUpId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO FollowUp (
            id, patientId, planDate, content, status, assigneeId,
            templateId, clinicId, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
        ).run(
          followUpId, patientId, rec.recommendedDate, rec.reason,
          options.assigneeId ?? null, rec.templateId, clinicId, now, now,
        );

        const assignmentId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO FollowUpAssignment (
            id, patientId, followUpId, templateId,
            recommendedDate, reason, confidence,
            createdBy, clinicId, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          assignmentId, patientId, followUpId, rec.templateId,
          rec.recommendedDate, rec.reason, rec.confidence,
          this.clinicContext.getUserId() ?? null, clinicId, now, now,
        );

        created.push({
          followUpId,
          assignmentId,
          patientId,
          recommendedDate: rec.recommendedDate,
        });

        this.logAudit(db, 'FollowUp_CREATED', followUpId, 'FollowUp', {
          afterData: {
            planDate: rec.recommendedDate,
            templateId: rec.templateId,
            confidence: rec.confidence,
          },
        });
      }
    });
    return created;
  }

  private resolvePatientIdFromRec(
    _rec: FollowUpRecommendResult,
    _db: IDatabase,
  ): string | undefined {
    return undefined;
  }

  async batchGenerate(limit: number = 200): Promise<BatchGenerateResult> {
    const batchEnabled = await this.settingsService.get('aiFollowUpBatchGenEnabled');
    if (batchEnabled === 'false') {
      return { totalProcessed: 0, totalGenerated: 0, skippedDueToExisting: 0 };
    }
    const recommendEnabled = await this.settingsService.get('aiFollowUpRecommendEnabled');
    if (recommendEnabled === 'false') {
      return { totalProcessed: 0, totalGenerated: 0, skippedDueToExisting: 0 };
    }

    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { totalProcessed: 0, totalGenerated: 0, skippedDueToExisting: 0 };
    }

    await this.seedTemplatesIfEmpty();

    const todayStr = new Date().toISOString().slice(0, 10);
    const ninetyDaysAgo = addDays(todayStr, -90);

    const candidatePatients = this.dbService.prepare(
      `SELECT DISTINCT V.patientId AS pid FROM Visit V
       INNER JOIN Treatment T ON T.visitId = V.id
       WHERE V.status = 'COMPLETED'
         AND T.status = 'COMPLETED'
         AND V.clinicId = ?
         AND V.deletedAt IS NULL
         AND T.deletedAt IS NULL
       LIMIT ?`, // soft-delete-exempt: 多行 JOIN 查询，V.deletedAt 和 T.deletedAt 已在 L449-450
    ).all(clinicId, limit * 2) as Array<Record<string, unknown>>;

    const normalizedPids = candidatePatients
      .map(row => row.pid ?? row.patientId ?? (row as { 'V.patientId'?: string })['V.patientId'])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);

    const mdb = this.dbService as unknown as { getTableData?: (t: string) => Array<Record<string, unknown>> };
    const hasTableData = typeof mdb.getTableData === 'function';
    const getData = (t: string) => hasTableData ? mdb.getTableData!(t) : this.dbService.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>;

    const allFollowUps = getData('FollowUp') as Array<{ patientId: string; createdAt?: string; clinicId?: string; deletedAt?: string }>;
    const allAssignments = getData('FollowUpAssignment') as Array<{ patientId: string; createdAt?: string; clinicId?: string; deletedAt?: string }>;

    const recentPatients = new Set<string>();
    for (const fu of allFollowUps) {
      if (fu.deletedAt || fu.clinicId !== clinicId) continue;
      const created = (fu.createdAt ?? '').slice(0, 10);
      if (created >= ninetyDaysAgo) recentPatients.add(fu.patientId);
    }
    for (const a of allAssignments) {
      if (a.deletedAt || a.clinicId !== clinicId) continue;
      const created = (a.createdAt ?? '').slice(0, 10);
      if (created >= ninetyDaysAgo) recentPatients.add(a.patientId);
    }


    const filteredPatients = normalizedPids
      .filter(pid => !recentPatients.has(pid))
      .map(pid => ({ pid }))
      .slice(0, limit);

    const totalProcessed = filteredPatients.length;
    let totalGenerated = 0;
    let skippedDueToExisting = 0;

    for (const { pid } of filteredPatients) {
      const recentVisits = this.dbService.prepare(
        `SELECT id FROM Visit
         WHERE patientId = ? AND status = 'COMPLETED' AND clinicId = ? AND deletedAt IS NULL
         ORDER BY createdAt DESC LIMIT 3`,
      ).all(pid, clinicId) as Array<{ id: string }>;

      const perPatientRecs: FollowUpRecommendResult[] = [];
      for (const v of recentVisits) {
        const recs = await this.recommendForVisit(v.id);
        for (const r of recs) {
          (r as unknown as { patientId: string }).patientId = pid;
          perPatientRecs.push(r);
        }
      }

      if (perPatientRecs.length === 0) continue;

      const results = await this.applyRecommendations(perPatientRecs);
      totalGenerated += results.length;
      skippedDueToExisting += Math.max(0, perPatientRecs.length - results.length);
    }

    return { totalProcessed, totalGenerated, skippedDueToExisting };
  }

  async getNextReminders(
    options: { patientId?: string; limit?: number; overdueOnly?: boolean } = {},
  ): Promise<Array<{
    id: string; planDate: string; patientId: string; patientName?: string;
    patientPhone?: string; content?: string; assigneeId?: string;
    treatmentName?: string; status: string;
  }>> {
    const { patientId, limit = 50, overdueOnly = false } = options;
    const today = new Date().toISOString().slice(0, 10);
    const future14 = addDays(today, 14);
    const { clause, params } = this.buildClinicClause();

    let wherePatient = '';
    const whereParams: unknown[] = [];
    if (patientId) {
      wherePatient = ' AND F.patientId = ?';
      whereParams.push(patientId);
    }

    let dateFilter: string;
    const dateParams: unknown[] = [];
    if (overdueOnly) {
      dateFilter = ' AND F.planDate < ?';
      dateParams.push(today);
    } else {
      dateFilter = ' AND F.planDate <= ?';
      dateParams.push(future14);
    }

    let rows = this.dbService.prepare(
      `SELECT F.id, F.planDate, F.patientId, F.content, F.assigneeId, F.status,
              P.name AS patientName, P.phone AS patientPhone
       FROM FollowUp F
       LEFT JOIN Patient P ON P.id = F.patientId
       WHERE F.status = 'PENDING' AND F.deletedAt IS NULL${clause}${wherePatient}${dateFilter}
       ORDER BY F.planDate ASC
       LIMIT ?`,
    ).all(...params, ...whereParams, ...dateParams, limit) as Array<{
      id: string; planDate: string; patientId: string; content?: string;
      assigneeId?: string; status: string; patientName?: string; patientPhone?: string;
    }>;

    if (overdueOnly) {
      rows = rows.filter(r => r.planDate < today);
    } else {
      rows = rows.filter(r => r.planDate <= future14);
    }

    return rows.map(r => ({ ...r, treatmentName: undefined }));
  }
}
