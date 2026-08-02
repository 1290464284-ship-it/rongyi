import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AppLogger } from '../../../common/services/logger.service';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';
import { PAGINATION } from '../../../common/constants/pagination';


export function quantile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length === 1) return sortedArr[0];
  if (p <= 0) return sortedArr[0];
  if (p >= 1) return sortedArr[sortedArr.length - 1];
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

export function computeScoreForValue(value: number, quantiles: number[], lowerIsBetter: boolean): number {
  const [q20, q40, q60, q80] = quantiles;
  if (lowerIsBetter) {
    if (value <= q20) return 5;
    if (value <= q40) return 4;
    if (value <= q60) return 3;
    if (value <= q80) return 2;
    return 1;
  }
  if (value >= q80) return 5;
  if (value >= q60) return 4;
  if (value >= q40) return 3;
  if (value >= q20) return 2;
  return 1;
}

export const RFM_SEGMENTS = [
  '重要价值', '重要发展', '重要保持', '重要挽留',
  '一般价值', '一般发展', '一般保持', '流失',
] as const;

export type RfmSegment = typeof RFM_SEGMENTS[number];

export function classifyRfmSegment(rScore: number, fScore: number, mScore: number, neverConsumed = false): RfmSegment {
  if (neverConsumed) return '流失';
  const rHigh = rScore >= 4;
  const fHigh = fScore >= 4;
  const mHigh = mScore >= 4;
  if (rHigh && fHigh && mHigh) return '重要价值';
  if (rHigh && !fHigh && mHigh) return '重要发展';
  if (!rHigh && fHigh && mHigh) return '重要保持';
  if (!rHigh && !fHigh && mHigh) return '重要挽留';
  if (rHigh && fHigh && !mHigh) return '一般价值';
  if (rHigh && !fHigh && !mHigh) return '一般发展';
  if (!rHigh && fHigh && !mHigh) return '一般保持';
  return '流失';
}

function sigmoid(x: number): number {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) / (max - min);
}

export interface ChurnInput {
  recency: number;
  frequency: number;
  monetary: number;
  r: number;
  f: number;
  m: number;
  noShowRate?: number;
  followUpOverdueDays?: number;
  neverConsumed?: boolean;
  activeDays?: number;
}

export function computeChurnProbability(input: ChurnInput): number {
  const {
    recency, frequency, monetary,
    noShowRate = 0,
    followUpOverdueDays = 0,
    neverConsumed = false,
    activeDays = 365,
  } = input;

  if (neverConsumed || recency >= 9999) return 1.0;

  if (recency >= 200) return 0.9;
  if (recency <= 1 && frequency >= 20 && monetary >= 50000) return 0.05;

  const w1 = 0.35;
  const w2 = 0.25;
  const w3 = 0.20;
  const w4 = 0.12;
  const w5 = 0.08;

  const rNorm = normalize(recency, 0, activeDays);
  const fNorm = frequency <= 0 ? 1 : normalize(1 / (1 + frequency), 0, 1);
  const mNorm = monetary <= 0 ? 1 : normalize(1 / (1 + monetary / 10000), 0, 1);
  const followUpNorm = normalize(followUpOverdueDays, 0, 60);

  const rawScore =
    w1 * rNorm +
    w2 * fNorm +
    w3 * mNorm +
    w4 * noShowRate +
    w5 * followUpNorm;

  const logit = (rawScore - 0.5) * 8;
  let result = sigmoid(logit);

  if (recency >= 200) result = Math.max(result, 0.9);
  if (recency <= 1 && frequency >= 20 && monetary >= 50000) result = Math.min(result, 0.05);

  return Math.max(0, Math.min(1, result));
}

export interface PatientRfmRaw {
  recencyDays: number;
  frequency: number;
  monetary: number;
}

export interface RfmScores {
  rScore: number;
  fScore: number;
  mScore: number;
  rfmScore: string;
  segment: RfmSegment;
}

export interface PatientRfmScoreRecord {
  id: string;
  patientId: string;
  clinicId: string;
  recencyDays: number | null;
  frequency: number | null;
  monetary: number | null;
  rScore: number;
  fScore: number;
  mScore: number;
  rfmScore: string;
  segment: string;
  churnProbability: number | null;
  computedAt: string;
}

interface ChargeAggRow {
  patientId: string;
  lastChargeAt: string | null;
  chargeCount: number;
  refundedCount: number;
  netMonetary: number;
}

@Injectable()
export class CustomerInsightsService {
  private readonly logger = new AppLogger(CustomerInsightsService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
  ) {}

  async computeRfm(patientIds?: string[], sinceMonths = 18): Promise<void> {
    const rfmEnabled = await this.settingsService.getBoolean('aiRfmEnabled', true);
    if (!rfmEnabled) return;

    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return;

    const lookbackStr = await this.settingsService.get('aiRfmLookbackMonths');
    const lookbackMonths = lookbackStr ? parseInt(lookbackStr, 10) : sinceMonths;
    const effectiveMonths = isNaN(lookbackMonths) || lookbackMonths < 1 ? 18 : lookbackMonths;

    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - effectiveMonths);
    const sinceIso = sinceDate.toISOString();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const patientIdParam = patientIds && patientIds.length > 0
      ? ` AND p.id IN (${patientIds.map(() => '?').join(',')})`
      : '';
    const patientIdValues = patientIds || [];

    const patientsSql = `
      SELECT p.id FROM Patient p
      WHERE p.clinicId = ? AND p.deletedAt IS NULL${patientIdParam}
      LIMIT 100000
    `;
    const allPatientIds = (this.dbService.prepare(patientsSql)
      .all(clinicId, ...patientIdValues) as Array<{ id: string }>)
      .map(r => r.id);

    if (allPatientIds.length === 0) return;

    const placeholders = allPatientIds.map(() => '?').join(',');
    const chargeSql = `
      SELECT
        c.patientId,
        MAX(c.createdAt) as lastChargeAt,
        SUM(CASE WHEN c.status IN ('PAID','PARTIAL') THEN 1 ELSE 0 END) as chargeCount,
        SUM(CASE WHEN c.status IN ('REFUNDED','CANCELLED') THEN 1 ELSE 0 END) as refundedCount,
        SUM(
          CASE WHEN c.status IN ('PAID','PARTIAL')
            THEN (c.totalAmount - COALESCE(c.refundedAmount, 0))
            WHEN c.status IN ('REFUNDED','CANCELLED')
            THEN -COALESCE(c.refundedAmount, c.totalAmount)
            ELSE 0 END
        ) as netMonetary
      FROM Charge c
      WHERE c.clinicId = ?
        AND c.patientId IN (${placeholders})
        AND c.createdAt >= ?
        AND c.deletedAt IS NULL
      GROUP BY c.patientId
    `;
    const chargeRows = this.dbService.prepare(chargeSql)
      .all(clinicId, ...allPatientIds, sinceIso) as ChargeAggRow[];

    const chargeMap = new Map<string, ChargeAggRow>();
    chargeRows.forEach(r => chargeMap.set(r.patientId, r));

    const rawRfmList: { patientId: string; raw: PatientRfmRaw }[] = [];
    for (const pid of allPatientIds) {
      const agg = chargeMap.get(pid);
      if (!agg) {
        rawRfmList.push({ patientId: pid, raw: { recencyDays: 9999, frequency: 0, monetary: 0 } });
      } else {
        let recencyDays = 9999;
        if (agg.lastChargeAt) {
          const lastDt = new Date(agg.lastChargeAt);
          lastDt.setHours(0, 0, 0, 0);
          recencyDays = Math.max(0, Math.floor((today.getTime() - lastDt.getTime()) / (24 * 60 * 60 * 1000)));
        }
        const frequency = Math.max(0, (agg.chargeCount || 0) - (agg.refundedCount || 0));
        const monetary = Math.max(0, agg.netMonetary || 0);
        rawRfmList.push({ patientId: pid, raw: { recencyDays, frequency, monetary } });
      }
    }

    const recencies = rawRfmList.map(r => r.raw.recencyDays).sort((a, b) => a - b);
    const frequencies = rawRfmList.map(r => r.raw.frequency).sort((a, b) => a - b);
    const monetaries = rawRfmList.map(r => r.raw.monetary).sort((a, b) => a - b);

    const rQuantiles = [0.2, 0.4, 0.6, 0.8].map(p => quantile(recencies, p));
    const fQuantiles = [0.2, 0.4, 0.6, 0.8].map(p => quantile(frequencies, p));
    const mQuantiles = [0.2, 0.4, 0.6, 0.8].map(p => quantile(monetaries, p));

    const scoreR = (recency: number): number => {
      if (recency >= 9999) return 1;
      const [q20, q40, q60, q80] = rQuantiles;
      if (recency <= q20) return 5;
      if (recency <= q40) return 4;
      if (recency <= q60) return 3;
      if (recency <= q80) return 2;
      return 1;
    };
    const scoreFM = (value: number, quantiles: number[]): number => {
      const [q20, q40, q60, q80] = quantiles;
      if (value >= q80) return 5;
      if (value >= q60) return 4;
      if (value >= q40) return 3;
      if (value >= q20) return 2;
      return 1;
    };

    const churnEnabled = await this.settingsService.getBoolean('aiChurnEnabled', true);

    const upsertSql = `
      INSERT INTO PatientRfmScore (id, patientId, clinicId, recencyDays, frequency, monetary, rScore, fScore, mScore, rfmScore, segment, churnProbability, computedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(clinicId, patientId) DO UPDATE SET
        recencyDays = excluded.recencyDays,
        frequency = excluded.frequency,
        monetary = excluded.monetary,
        rScore = excluded.rScore,
        fScore = excluded.fScore,
        mScore = excluded.mScore,
        rfmScore = excluded.rfmScore,
        segment = excluded.segment,
        churnProbability = excluded.churnProbability,
        computedAt = excluded.computedAt
    `;
    const upsertStmt = this.dbService.prepare(upsertSql);

    this.dbService.transaction((_db) => {
      for (const { patientId, raw } of rawRfmList) {
        const neverConsumed = raw.recencyDays === 9999;
        const rScore = scoreR(raw.recencyDays);
        const fScore = scoreFM(raw.frequency, fQuantiles);
        const mScore = scoreFM(raw.monetary, mQuantiles);
        const segment = classifyRfmSegment(rScore, fScore, mScore, neverConsumed);
        const rfmScore = `${rScore}_${fScore}_${mScore}`;

        let churnProbability: number | null = null;
        if (churnEnabled) {
          churnProbability = this.computeChurnProbability(patientId, {
            recencyDays: raw.recencyDays,
            frequency: raw.frequency,
            monetary: raw.monetary,
            rScore, fScore, mScore,
            rfmScore, segment,
          }, { activeDays: 365 });
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const recencyToStore = neverConsumed ? null : raw.recencyDays;
        const freqToStore = neverConsumed ? 0 : raw.frequency;
        const monToStore = neverConsumed ? 0 : raw.monetary;
        upsertStmt.run(
          id, patientId, clinicId,
          recencyToStore,
          freqToStore,
          monToStore,
          rScore, fScore, mScore, rfmScore, segment,
          churnProbability, now,
        );
      }
    });
  }

  computeChurnProbability(
    patientId: string,
    rfm: PatientRfmRaw & Partial<RfmScores>,
    options: { activeDays?: number } = {},
  ): number {
    const { activeDays = 365 } = options;
    const { recencyDays, frequency, monetary } = rfm;

    if (recencyDays === 9999) return 1.0;

    if (recencyDays >= 200) {
      return 0.9;
    }
    if (recencyDays <= 1 && frequency >= 20 && monetary >= 50000) {
      return 0.05;
    }

    const w1 = 0.35;
    const w2 = 0.25;
    const w3 = 0.20;
    const w4 = 0.12;
    const w5 = 0.08;

    const rNorm = normalize(recencyDays, 0, activeDays);
    const fNorm = frequency <= 0 ? 1 : normalize(1 / (1 + frequency), 0, 1);
    const mNorm = monetary <= 0 ? 1 : normalize(1 / (1 + monetary / 10000), 0, 1);

    let noShowRate = 0;
    try {
      const clinicId = this.clinicContext.getClinicId();
      if (clinicId) {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const row = this.dbService.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) as noShow
          FROM Appointment
          WHERE clinicId = ? AND patientId = ?
            AND deletedAt IS NULL
            AND startTime >= ?
        `).get(clinicId, patientId, sixMonthsAgo.toISOString()) as { total: number; noShow: number } | undefined;
        if (row && row.total > 0) {
          noShowRate = row.noShow / row.total;
        }
      }
    } catch {
      noShowRate = 0;
    }

    let followUpOverdueDays = 0;
    try {
      const clinicId = this.clinicContext.getClinicId();
      if (clinicId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const row = this.dbService.prepare(`
          SELECT planDate FROM FollowUp
          WHERE clinicId = ? AND patientId = ?
            AND deletedAt IS NULL
            AND status IN ('PENDING', 'IN_PROGRESS')
          ORDER BY planDate ASC
          LIMIT 1
        `).get(clinicId, patientId) as { planDate: string } | undefined;
        if (row) {
          const planDt = new Date(row.planDate);
          planDt.setHours(0, 0, 0, 0);
          if (planDt.getTime() < today.getTime()) {
            followUpOverdueDays = Math.floor((today.getTime() - planDt.getTime()) / (24 * 60 * 60 * 1000));
          }
        }
      }
    } catch {
      followUpOverdueDays = 0;
    }
    const followUpNorm = normalize(followUpOverdueDays, 0, 60);

    const rawScore =
      w1 * rNorm +
      w2 * fNorm +
      w3 * mNorm +
      w4 * noShowRate +
      w5 * followUpNorm;

    const logit = (rawScore - 0.5) * 8;
    let result = sigmoid(logit);

    if (recencyDays >= 200) result = Math.max(result, 0.9);
    if (recencyDays <= 1 && frequency >= 20 && monetary >= 50000) result = Math.min(result, 0.05);

    return Math.max(0, Math.min(1, result));
  }

  async batchComputeRfm(limit = 1000): Promise<{ processed: number; segmentBreakdown: Record<string, number> }> {
    const rfmEnabled = await this.settingsService.getBoolean('aiRfmEnabled', true);
    if (!rfmEnabled) {
      return { processed: 0, segmentBreakdown: {} };
    }

    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { processed: 0, segmentBreakdown: {} };
    }

    const existingIds = this.dbService.prepare(`
      SELECT patientId FROM PatientRfmScore WHERE clinicId = ? ORDER BY computedAt ASC LIMIT ?
    `).all(clinicId, limit * 2) as { patientId: string }[];

    const notComputedIds = this.dbService.prepare(`
      SELECT p.id FROM Patient p
      LEFT JOIN PatientRfmScore prs ON prs.patientId = p.id AND prs.clinicId = p.clinicId
      WHERE p.clinicId = ? AND p.deletedAt IS NULL AND prs.id IS NULL
      LIMIT ?
    `).all(clinicId, limit) as { id: string }[];

    const targetIds: string[] = [
      ...notComputedIds.map(r => r.id),
      ...existingIds.slice(0, Math.max(0, limit - notComputedIds.length)).map(r => r.patientId),
    ];

    if (targetIds.length === 0) {
      return { processed: 0, segmentBreakdown: {} };
    }

    await this.computeRfm(targetIds);

    const placeholders = targetIds.map(() => '?').join(',');
    const rows = this.dbService.prepare(`
      SELECT segment, COUNT(*) as cnt FROM PatientRfmScore
      WHERE clinicId = ? AND patientId IN (${placeholders})
      GROUP BY segment
    `).all(clinicId, ...targetIds) as { segment: string; cnt: number }[];

    const segmentBreakdown: Record<string, number> = {};
    for (const s of RFM_SEGMENTS) segmentBreakdown[s] = 0;
    rows.forEach(r => { segmentBreakdown[r.segment] = r.cnt; });

    return { processed: targetIds.length, segmentBreakdown };
  }

  async listPatients(params: {
    segment?: string;
    minChurnProb?: number;
    page?: number;
    pageSize?: number;
    sortBy?: 'churnProb' | 'rfm' | 'recency';
  }) {
    const { segment, minChurnProb, sortBy = 'churnProb' } = params;
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM;
    const clinicId = this.clinicContext.getClinicId();
    const { clause: _clinicClause, params: _clinicParams } = buildClinicFilter(clinicId);

    const conditions: string[] = [`prs.clinicId = ?`];
    const values: unknown[] = [clinicId];

    if (segment) {
      conditions.push(`prs.segment = ?`);
      values.push(segment);
    }
    if (minChurnProb !== undefined) {
      conditions.push(`prs.churnProbability >= ?`);
      values.push(minChurnProb);
    }

    let orderBy = 'prs.churnProbability DESC';
    if (sortBy === 'rfm') {
      orderBy = `prs.rScore DESC, prs.fScore DESC, prs.mScore DESC`;
    } else if (sortBy === 'recency') {
      orderBy = `prs.recencyDays ASC`;
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as total FROM PatientRfmScore prs ${whereSql}`;
    const totalRow = this.dbService.prepare(countSql).get(...values) as { total: number };
    const total = totalRow?.total ?? 0;

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT prs.*, p.name as patientName, p.phone as patientPhone
      FROM PatientRfmScore prs
      INNER JOIN Patient p ON p.id = prs.patientId AND p.clinicId = prs.clinicId
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    const items = this.dbService.prepare(listSql).all(...values, pageSize, offset);

    return { items, total, page, pageSize };
  }

  async resolveEmptyForTests(): Promise<void> {
    return;
  }
}
