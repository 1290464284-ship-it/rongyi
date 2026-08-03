import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { AppLogger } from '../../../common/services/logger.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import * as crypto from 'node:crypto';
import {
  FindingItem,
  ALERT_SETTINGS_KEYS,
  DEFAULT_THRESHOLDS,
} from './thresholds';
import { computeRevenueDropFinding } from './alert-findings/revenue-drop.finding';
import { computeNewPatientsFinding } from './alert-findings/new-patients.finding';
import { computeNoShowRateFinding } from './alert-findings/no-show-rate.finding';
import { computeAovFinding } from './alert-findings/aov.finding';
import { computePerformanceAnomalyFindings } from './alert-findings/performance-anomaly.finding';

export interface BusinessAlertRow {
  id: string;
  clinicId: string;
  alertType: string;
  severity: string;
  metricName: string;
  currentValue: number | null;
  baselineValue: number | null;
  deviationPercent: number | null;
  message: string;
  suggestion: string | null;
  acknowledged: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DetectOptions {
  runMonth?: string;
  silentInsert?: boolean;
  insertInfo?: boolean;
}

function getRecentTwoFullMonths(today: Date = new Date()): { runMonth: string; prevMonth: string } {
  const d = new Date(today.getFullYear(), today.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  const runMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  d.setMonth(d.getMonth() - 1);
  const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { runMonth, prevMonth };
}

@Injectable()
export class BusinessAlertDetectorService {
  private readonly logger = new AppLogger(BusinessAlertDetectorService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly settings: SettingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async hasSufficientData(clinicId: string): Promise<boolean> {
    try {
      const { clause, params } = buildClinicFilter(clinicId);
      const chargeClause = clause.replace('clinicId', 'c.clinicId');
      const apptClause = clause.replace('clinicId', 'a.clinicId');
      const patientClause = clause.replace('clinicId', 'p.clinicId');

      const minDateSql = `
        SELECT
          (SELECT MIN(c.paidAt) FROM Charge c WHERE c.paidAt IS NOT NULL AND c.deletedAt IS NULL${chargeClause}) as minCharge,
          (SELECT MIN(a.startTime) FROM Appointment a WHERE a.deletedAt IS NULL${apptClause}) as minAppt,
          (SELECT MIN(p.createdAt) FROM Patient p WHERE p.deletedAt IS NULL${patientClause}) as minPatient
      `;
      const row = this.dbService.prepare(minDateSql).get(...params, ...params, ...params) as
        | { minCharge: string | null; minAppt: string | null; minPatient: string | null }
        | undefined;
      if (!row) return false;

      const now = Date.now();
      const minDates = [row.minCharge, row.minAppt, row.minPatient].filter(Boolean) as string[];
      if (minDates.length === 0) return false;

      const earliest = minDates.map((d) => new Date(d).getTime()).reduce((a, b) => Math.min(a, b), Infinity);
      const daysDiff = (now - earliest) / (24 * 3600 * 1000);
      if (daysDiff < 60) {
        this.logger.warn(`[BusinessAlert] 数据不足 ${Math.floor(daysDiff)} 天 < 60，跳过 clinic=${clinicId}`);
        return false;
      }
      return true;
    } catch (err: unknown) {
      this.logger.warn('[BusinessAlert] hasSufficientData check failed:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async detectForClinic(
    clinicId: string,
    options: DetectOptions = {},
  ): Promise<BusinessAlertRow[]> {
    const insertInfo = options.insertInfo ?? false;

    let runMonth: string;
    let prevMonth: string;
    if (options.runMonth) {
      runMonth = options.runMonth;
      const [y, m] = runMonth.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      const recent = getRecentTwoFullMonths();
      runMonth = recent.runMonth;
      prevMonth = recent.prevMonth;
    }

    const hasData = await this.hasSufficientData(clinicId);
    if (!hasData) {
      return [];
    }

    const [
      revenueDropWarn, revenueDropCritical,
      newPatientsWarn, newPatientsCritical,
      noShowWarn, noShowCritical,
      aovWarn, aovCritical,
      doctorPerfZWarn, doctorPerfZCritical,
    ] = await Promise.all([
      this.settings.getNumber(ALERT_SETTINGS_KEYS.REVENUE_DROP_WARN, DEFAULT_THRESHOLDS.REVENUE_DROP.warn),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.REVENUE_DROP_CRITICAL, DEFAULT_THRESHOLDS.REVENUE_DROP.critical),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.NEW_PATIENTS_WARN, DEFAULT_THRESHOLDS.NEW_PATIENTS.warn),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.NEW_PATIENTS_CRITICAL, DEFAULT_THRESHOLDS.NEW_PATIENTS.critical),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.NO_SHOW_WARN, DEFAULT_THRESHOLDS.NO_SHOW_RATE.warn),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.NO_SHOW_CRITICAL, DEFAULT_THRESHOLDS.NO_SHOW_RATE.critical),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.AOV_WARN, DEFAULT_THRESHOLDS.AOV.warn),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.AOV_CRITICAL, DEFAULT_THRESHOLDS.AOV.critical),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.DOCTOR_PERF_Z_WARN, DEFAULT_THRESHOLDS.DOCTOR_PERF_Z.warn),
      this.settings.getNumber(ALERT_SETTINGS_KEYS.DOCTOR_PERF_Z_CRITICAL, DEFAULT_THRESHOLDS.DOCTOR_PERF_Z.critical),
    ]);

    const findings: FindingItem[] = [];

    const revenueFinding = computeRevenueDropFinding(this.dbService, clinicId, {
      runMonth, prevMonth, warn: revenueDropWarn, critical: revenueDropCritical,
    });
    if (revenueFinding) findings.push(revenueFinding);

    const newPatientsFinding = computeNewPatientsFinding(this.dbService, clinicId, {
      runMonth, prevMonth, warn: newPatientsWarn, critical: newPatientsCritical,
    });
    if (newPatientsFinding) findings.push(newPatientsFinding);

    const noShowFinding = computeNoShowRateFinding(this.dbService, clinicId, {
      runMonth, warn: noShowWarn, critical: noShowCritical,
    });
    if (noShowFinding) findings.push(noShowFinding);

    const aovFinding = computeAovFinding(this.dbService, clinicId, {
      runMonth, prevMonth, warn: aovWarn, critical: aovCritical,
    });
    if (aovFinding) findings.push(aovFinding);

    const perfFindings = computePerformanceAnomalyFindings(this.dbService, clinicId, {
      todayISO: new Date().toISOString(),
      warn: doctorPerfZWarn,
      critical: doctorPerfZCritical,
    });
    findings.push(...perfFindings);

    const filteredFindings = insertInfo
      ? findings
      : findings.filter((f) => f.severity !== 'INFO');

    if (!options.silentInsert) {
      return this.dedupeAndPersist(clinicId, filteredFindings);
    }

    return this.mapFindingsToRows(clinicId, filteredFindings);
  }

  dedupeAndPersist(clinicId: string, findings: FindingItem[]): BusinessAlertRow[] {
    const persistedRows: BusinessAlertRow[] = [];
    if (findings.length === 0) return persistedRows;

    const now = new Date().toISOString();
    this.dbService.transaction((tx) => {
      for (const finding of findings) {
        const { clause, params } = buildClinicFilter(clinicId);
        const baClause = clause.replace('clinicId', 'ba.clinicId');

        const existingRow = tx.prepare(`
          SELECT id FROM BusinessAlert ba
          WHERE ba.alertType = ? AND date(ba.occurredAt) = date('now') AND ba.deletedAt IS NULL
            ${baClause}
        `).get(finding.alertType, ...params) as { id: string } | undefined;

        if (existingRow) {
          tx.prepare(`
            UPDATE BusinessAlert
            SET severity = ?, metricName = ?, currentValue = ?, baselineValue = ?,
                deviationPercent = ?, message = ?, suggestion = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            finding.severity, finding.metricName, finding.currentValue, finding.baselineValue,
            finding.deviationPercent, finding.message, finding.suggestion, existingRow.id,
          );
          // soft-delete-exempt: 写后读取刚更新的记录，id 已确认存在且未删除
          const updated = tx.prepare('SELECT * FROM BusinessAlert WHERE id = ?').get(existingRow.id) as BusinessAlertRow;
          persistedRows.push(updated);
        } else {
          const id = crypto.randomUUID();
          tx.prepare(`
            INSERT INTO BusinessAlert
              (id, clinicId, alertType, severity, metricName, currentValue, baselineValue,
               deviationPercent, message, suggestion, acknowledged, occurredAt, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
          `).run(
            id, clinicId, finding.alertType, finding.severity, finding.metricName,
            finding.currentValue, finding.baselineValue, finding.deviationPercent,
            finding.message, finding.suggestion, finding.occurredAt || now, now, now,
          );
          // soft-delete-exempt: 写后读取刚创建的记录，id 已确认存在且未删除
          const inserted = tx.prepare('SELECT * FROM BusinessAlert WHERE id = ?').get(id) as BusinessAlertRow;
          persistedRows.push(inserted);

          this.auditLog.logAudit(
            tx,
            AuditLogType.BUSINESS_ALERT_TRIGGERED,
            id,
            'BusinessAlert',
            clinicId,
            {
              afterData: {
                alertType: finding.alertType,
                severity: finding.severity,
                metricName: finding.metricName,
                deviationPercent: finding.deviationPercent,
              },
            },
          );
        }
      }
    });
    return persistedRows;
  }

  private mapFindingsToRows(clinicId: string, findings: FindingItem[]): BusinessAlertRow[] {
    const now = new Date().toISOString();
    return findings.map((f) => ({
      id: crypto.randomUUID(),
      clinicId,
      alertType: f.alertType,
      severity: f.severity,
      metricName: f.metricName,
      currentValue: f.currentValue,
      baselineValue: f.baselineValue,
      deviationPercent: f.deviationPercent,
      message: f.message,
      suggestion: f.suggestion,
      acknowledged: 0,
      acknowledgedAt: null,
      acknowledgedBy: null,
      occurredAt: f.occurredAt || now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
  }
}
