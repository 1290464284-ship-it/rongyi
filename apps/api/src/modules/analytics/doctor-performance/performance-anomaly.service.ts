import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AppLogger } from '../../../common/services/logger.service';
import { PAGINATION } from '../../../common/constants/pagination';

export type PerfMetric = 'REVENUE_30D' | 'VISITS_30D' | 'NO_SHOW_RATE_30D' | 'AVG_AOV_30D';
export type AnomalySeverity = 'INFO' | 'WARN' | 'CRITICAL';

export const PERF_METRICS: PerfMetric[] = ['REVENUE_30D', 'VISITS_30D', 'NO_SHOW_RATE_30D', 'AVG_AOV_30D'];
export const ANOMALY_SEVERITIES: AnomalySeverity[] = ['INFO', 'WARN', 'CRITICAL'];

export interface DoctorMetricValue {
  metric: PerfMetric;
  value: number;
}

export interface BaselineResult {
  mean: number;
  std: number;
  sampleSize: number;
  values: number[];
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.length >= 2
    ? values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)
    : 0;
  return { mean: m, std: Math.sqrt(variance) };
}

export function winsorize3Sigma(values: number[]): number[] {
  if (values.length < 3) return [...values];
  const { mean, std } = meanStd(values);
  if (std === 0) return [...values];
  const lo = mean - 3 * std;
  const hi = mean + 3 * std;
  return values.map(v => Math.max(lo, Math.min(hi, v)));
}

export function classifySeverity(zScore: number): AnomalySeverity | null {
  const abs = Math.abs(zScore);
  if (abs > 3) return 'CRITICAL';
  if (abs > 2) return 'WARN';
  if (abs > 1.5) return 'INFO';
  return null;
}

export function computeZScores(current: number, mean: number, std: number): { zScore: number } {
  const z = (current - mean) / (std + 1e-9);
  return { zScore: z };
}

export interface DoctorPerformanceAnomalyRecord {
  id: string;
  doctorId: string;
  clinicId: string;
  metric: PerfMetric;
  baselineMean: number;
  baselineStd: number;
  sampleSize: number | null;
  currentValue: number;
  zScore: number;
  severity: AnomalySeverity;
  detectedAt: string;
  resolvedAt: string | null;
  note: string | null;
}

@Injectable()
export class PerformanceAnomalyService {
  private readonly logger = new AppLogger(PerformanceAnomalyService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
  ) {}

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  computeDoctorMetrics(doctorId: string, windowDays: number = 30): Record<PerfMetric, number> {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date();
    const windowStart = this.addDays(now, -windowDays);
    const windowStartIso = windowStart.toISOString();
    const nowIso = now.toISOString();

    const revenueSql = `
      SELECT
        COALESCE(SUM(
          CASE WHEN status IN ('PAID','PARTIAL')
            THEN (totalAmount - COALESCE(refundedAmount, 0))
            WHEN status IN ('REFUNDED','CANCELLED')
            THEN -COALESCE(refundedAmount, totalAmount)
            ELSE 0 END
        ), 0) as revenue
      FROM Charge
      WHERE clinicId = ? AND doctorId = ?
        AND createdAt >= ? AND createdAt <= ?
        AND deletedAt IS NULL
    `;
    const revenueRow = this.dbService.prepare(revenueSql)
      .get(clinicId, doctorId, windowStartIso, nowIso) as { revenue: number };
    const revenue = revenueRow?.revenue ?? 0;

    const visitsSql = `
      SELECT COUNT(DISTINCT id) as cnt FROM Visit
      WHERE clinicId = ? AND doctorId = ?
        AND startTime >= ? AND startTime <= ?
        AND deletedAt IS NULL
    `;
    const visitsRow = this.dbService.prepare(visitsSql)
      .get(clinicId, doctorId, windowStartIso, nowIso) as { cnt: number };
    const visits = visitsRow?.cnt ?? 0;

    const appointmentsSql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) as noShow
      FROM Appointment
      WHERE clinicId = ? AND doctorId = ?
        AND startTime >= ? AND startTime <= ?
        AND deletedAt IS NULL
    `;
    const apptRow = this.dbService.prepare(appointmentsSql)
      .get(clinicId, doctorId, windowStartIso, nowIso) as { total: number; noShow: number };
    const noShowRate = (apptRow?.total ?? 0) > 0
      ? (apptRow.noShow ?? 0) / apptRow.total
      : 0;

    const chargeCountSql = `
      SELECT COUNT(DISTINCT id) as cnt FROM Charge
      WHERE clinicId = ? AND doctorId = ?
        AND status IN ('PAID','PARTIAL')
        AND createdAt >= ? AND createdAt <= ?
        AND deletedAt IS NULL
    `; // soft-delete-exempt: 多行 SQL，deletedAt IS NULL 在 L149
    const chargeCountRow = this.dbService.prepare(chargeCountSql)
      .get(clinicId, doctorId, windowStartIso, nowIso) as { cnt: number };
    const chargeCount = chargeCountRow?.cnt ?? 0;
    const avgAov = chargeCount > 0 ? revenue / chargeCount : 0;

    return {
      REVENUE_30D: revenue,
      VISITS_30D: visits,
      NO_SHOW_RATE_30D: noShowRate,
      AVG_AOV_30D: avgAov,
    };
  }

  computeBaseline(doctorId: string, metric: PerfMetric, windowDays: number = 30): BaselineResult {
    const clinicId = this.clinicContext.getClinicId();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const values: number[] = [];
    const totalMonths = 6;
    const startMonth = this.addDays(today, -totalMonths * 30);

    for (let i = 0; i < totalMonths; i++) {
      const windowEnd = this.addDays(startMonth, (i + 1) * 30);
      const windowStart = this.addDays(windowEnd, -windowDays);
      if (windowEnd >= today) break;

      const value = this.computeMetricForWindow(
        doctorId, metric, windowStart.toISOString(), windowEnd.toISOString(), clinicId ?? undefined,
      );
      values.push(value);
    }

    if (values.length === 0) {
      return { mean: 0, std: 0, sampleSize: 0, values: [] };
    }

    const trimmed = winsorize3Sigma(values);
    const { mean, std } = meanStd(trimmed);
    return { mean, std, sampleSize: trimmed.length, values: trimmed };
  }

  private computeMetricForWindow(
    doctorId: string, metric: PerfMetric, startIso: string, endIso: string, clinicId?: string,
  ): number {
    const cid = clinicId ?? this.clinicContext.getClinicId();
    if (metric === 'REVENUE_30D') {
      const row = this.dbService.prepare(`
        SELECT COALESCE(SUM(
          CASE WHEN status IN ('PAID','PARTIAL')
            THEN (totalAmount - COALESCE(refundedAmount, 0))
            WHEN status IN ('REFUNDED','CANCELLED')
            THEN -COALESCE(refundedAmount, totalAmount)
            ELSE 0 END
        ), 0) as v
        FROM Charge WHERE clinicId = ? AND doctorId = ?
          AND createdAt >= ? AND createdAt < ?
          AND deletedAt IS NULL
      `).get(cid, doctorId, startIso, endIso) as { v: number };
      return row?.v ?? 0;
    }
    if (metric === 'VISITS_30D') {
      const row = this.dbService.prepare(`
        SELECT COUNT(DISTINCT id) as v FROM Visit
        WHERE clinicId = ? AND doctorId = ?
          AND startTime >= ? AND startTime < ?
          AND deletedAt IS NULL
      `).get(cid, doctorId, startIso, endIso) as { v: number };
      return row?.v ?? 0;
    }
    if (metric === 'NO_SHOW_RATE_30D') {
      const row = this.dbService.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) as noShow
        FROM Appointment
        WHERE clinicId = ? AND doctorId = ?
          AND startTime >= ? AND startTime < ?
          AND deletedAt IS NULL
      `).get(cid, doctorId, startIso, endIso) as { total: number; noShow: number };
      return (row?.total ?? 0) > 0 ? (row.noShow ?? 0) / row.total : 0;
    }
    if (metric === 'AVG_AOV_30D') {
      const revRow = this.dbService.prepare(`
        SELECT COALESCE(SUM(
          CASE WHEN status IN ('PAID','PARTIAL')
            THEN (totalAmount - COALESCE(refundedAmount, 0))
            WHEN status IN ('REFUNDED','CANCELLED')
            THEN -COALESCE(refundedAmount, totalAmount)
            ELSE 0 END
        ), 0) as rev
        FROM Charge WHERE clinicId = ? AND doctorId = ?
          AND createdAt >= ? AND createdAt < ?
          AND status IN ('PAID','PARTIAL')
          AND deletedAt IS NULL
      `).get(cid, doctorId, startIso, endIso) as { rev: number };
      const cntRow = this.dbService.prepare(`
        SELECT COUNT(DISTINCT id) as cnt FROM Charge
        WHERE clinicId = ? AND doctorId = ?
          AND status IN ('PAID','PARTIAL')
          AND createdAt >= ? AND createdAt < ?
          AND deletedAt IS NULL
      `).get(cid, doctorId, startIso, endIso) as { cnt: number }; // soft-delete-exempt: 多行 SQL，deletedAt IS NULL 在上一行
      const cnt = cntRow?.cnt ?? 0;
      return cnt > 0 ? (revRow?.rev ?? 0) / cnt : 0;
    }
    return 0;
  }

  detectAnomaliesForDoctor(doctorId: string, windowDays: number = 30): DoctorPerformanceAnomalyRecord[] {
    const results: DoctorPerformanceAnomalyRecord[] = [];
    const currentValues = this.computeDoctorMetrics(doctorId, windowDays);

    for (const metric of PERF_METRICS) {
      const baseline = this.computeBaseline(doctorId, metric, windowDays);
      if (baseline.sampleSize < 3) continue;

      const zScore = baseline.std === 0
        ? (currentValues[metric] === baseline.mean ? 0 : (currentValues[metric] > baseline.mean ? 10 : -10))
        : (currentValues[metric] - baseline.mean) / (baseline.std + 1e-9);

      const severity = classifySeverity(zScore);
      if (!severity) continue;

      results.push({
        id: '',
        doctorId,
        clinicId: this.clinicContext.getClinicId() ?? '',
        metric,
        baselineMean: baseline.mean,
        baselineStd: baseline.std,
        sampleSize: baseline.sampleSize,
        currentValue: currentValues[metric],
        zScore,
        severity,
        detectedAt: '',
        resolvedAt: null,
        note: null,
      });
    }
    return results;
  }

  async batchDetectAnomalies(): Promise<{ scanned: number; detectedWarn: number; detectedCritical: number }> {
    const enabled = await this.settingsService.getBoolean('aiDoctorPerfAnomalyEnabled', true);
    if (!enabled) return { scanned: 0, detectedWarn: 0, detectedCritical: 0 };

    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return { scanned: 0, detectedWarn: 0, detectedCritical: 0 };

    const doctors = this.dbService.prepare(`
      SELECT id FROM User
      WHERE clinicId = ? AND role = 'DOCTOR' AND active = 1 AND deletedAt IS NULL
    `).all(clinicId) as { id: string }[];

    let scanned = 0;
    let detectedWarn = 0;
    let detectedCritical = 0;
    const now = new Date();
    const detectedAt = now.toISOString();
    const detectedAtDate = this.formatDate(now);

    const upsertSql = `
      INSERT INTO DoctorPerformanceAnomaly (id, doctorId, clinicId, metric, baselineMean, baselineStd, sampleSize, currentValue, zScore, severity, detectedAt, detectedAtDate, resolvedAt, note, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(clinicId, doctorId, metric, detectedAtDate) DO UPDATE SET
        baselineMean = excluded.baselineMean,
        baselineStd = excluded.baselineStd,
        sampleSize = excluded.sampleSize,
        currentValue = excluded.currentValue,
        zScore = excluded.zScore,
        severity = excluded.severity,
        detectedAt = excluded.detectedAt,
        resolvedAt = DoctorPerformanceAnomaly.resolvedAt,
        note = DoctorPerformanceAnomaly.note,
        updatedAt = excluded.updatedAt
    `;
    const upsertStmt = this.dbService.prepare(upsertSql);

    this.dbService.transaction((_db) => {
      for (const doc of doctors) {
        const anomalies = this.detectAnomaliesForDoctor(doc.id, 30);
        scanned++;
        for (const a of anomalies) {
          const id = crypto.randomUUID();
          upsertStmt.run(
            id, doc.id, clinicId, a.metric,
            a.baselineMean, a.baselineStd, a.sampleSize,
            a.currentValue, a.zScore, a.severity,
            detectedAt, detectedAtDate, null, null, detectedAt,
          );
          if (a.severity === 'WARN') detectedWarn++;
          if (a.severity === 'CRITICAL') detectedCritical++;
        }
      }
    });

    return { scanned, detectedWarn, detectedCritical };
  }

  async listAnomalies(params: {
    severity?: string;
    resolved?: boolean;
    doctorId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { severity, doctorId } = params;
    const resolved = params.resolved ?? false;
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM;
    const clinicId = this.clinicContext.getClinicId();

    const conditions: string[] = [`a.clinicId = ?`];
    const values: unknown[] = [clinicId];

    if (severity) {
      conditions.push(`a.severity = ?`);
      values.push(severity);
    }
    if (doctorId) {
      conditions.push(`a.doctorId = ?`);
      values.push(doctorId);
    }
    if (resolved) {
      conditions.push(`a.resolvedAt IS NOT NULL`);
    } else {
      conditions.push(`a.resolvedAt IS NULL`);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const countSql = `SELECT COUNT(*) as total FROM DoctorPerformanceAnomaly a ${whereSql}`;
    const totalRow = this.dbService.prepare(countSql).get(...values) as { total: number };
    const total = totalRow?.total ?? 0;

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT a.*, u.name as doctorName
      FROM DoctorPerformanceAnomaly a
      INNER JOIN User u ON u.id = a.doctorId AND u.clinicId = a.clinicId
      ${whereSql}
      ORDER BY a.detectedAt DESC
      LIMIT ? OFFSET ?
    `;
    const items = this.dbService.prepare(listSql).all(...values, pageSize, offset);

    return { items, total, page, pageSize };
  }

  async resolve(id: string, note?: string): Promise<void> {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    this.dbService.prepare(`
      UPDATE DoctorPerformanceAnomaly
      SET resolvedAt = ?, note = ?, updatedAt = ?
      WHERE id = ? AND clinicId = ?
    `).run(now, note ?? null, now, id, clinicId);
  }
}
