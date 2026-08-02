import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { AppLogger } from '../../../common/services/logger.service';
import { safeJsonArray } from '../../../common/utils/format/json.utils';
import {
  PlanProgressDetailDto,
  PlanProgressItemDto,
  PlanProgressTotalsDto,
} from './dto/plan-progress.dto';
import { DoctorBoardDto, OverduePlanTopDto } from './dto/doctor-board.dto';
import { ClinicBoardDto } from './dto/clinic-board.dto';
import { TrendPointDto } from './dto/trend.dto';
import { AuditLogType } from '../../../common/constants/audit-log-types';

const AVG_DAYS_PER_ITEM = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STATUS_WEIGHT: Record<string, number> = {
  PLANNED: 0,
  IN_PROGRESS: 0.5,
  COMPLETED: 1,
  CANCELLED: 0,
  SKIPPED: 0.5,
};

const STATUS_ORDER: Record<string, number> = {
  IN_PROGRESS: 0,
  PLANNED: 1,
  COMPLETED: 2,
  SKIPPED: 3,
  CANCELLED: 4,
};

interface InternalPlanRow {
  id: string;
  patientId: string;
  visitId?: string;
  doctorId: string;
  name: string;
  status: string;
  totalFee: number;
  clinicId: string;
  createdAt: string;
}

interface InternalItemRow {
  id: string;
  planId: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string | null;
  status: string;
  treatmentId: string | null;
  completedAt: string | null;
  remark: string | null;
  clinicId: string;
}

@Injectable()
export class TreatmentProgressService {
  private readonly logger = new AppLogger(TreatmentProgressService.name);
  private readonly auditLogService: AuditLogService;

  constructor(
    private readonly dbService: DbService,
    private readonly clinicContext: ClinicContextService,
    private readonly settingsService: SettingsService,
  ) {
    this.auditLogService = new AuditLogService();
  }

  private buildClinicClause(prefix = ' AND '): { clause: string; params: unknown[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return { clause: '', params: [] };
    return { clause: `${prefix}clinicId = ?`, params: [clinicId] };
  }

  private parseDateSafe(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  private toYmd(date: Date): string {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private daysBetween(a: Date, b: Date): number {
    const ms = a.getTime() - b.getTime();
    return Math.floor(ms / MS_PER_DAY);
  }

  private async getOverdueThresholdDays(): Promise<number> {
    return this.settingsService.getNumber('aiTreatmentPlanOverdueThresholdDays', 7);
  }

  async isEnabled(): Promise<boolean> {
    return this.settingsService.getBoolean('aiTreatmentProgressEnabled', true);
  }

  async calcPlanProgress(planId: string): Promise<PlanProgressDetailDto> {
    const enabled = await this.isEnabled();
    if (!enabled) return this.emptyPlanProgressDetail(planId);

    const thresholdDays = await this.getOverdueThresholdDays();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const plan = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, name, status, totalFee, clinicId, createdAt
       FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(planId, ...clinicParams) as InternalPlanRow | undefined;

    if (!plan) return this.emptyPlanProgressDetail(planId);

    const itemsRows = this.dbService.prepare(
      `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status,
              treatmentId, completedAt, remark, clinicId
       FROM TreatmentPlanItem
       WHERE planId = ? AND deletedAt IS NULL${clinicClause}
       ORDER BY id ASC`
    ).all(planId, ...clinicParams) as InternalItemRow[];

    return this.computeFromRows({
      plan,
      itemsRows,
      thresholdDays,
    });
  }

  private emptyPlanProgressDetail(planId: string): PlanProgressDetailDto {
    return {
      planId,
      planName: '',
      planStatus: '',
      planCreatedAt: '',
      completionPercent: 0,
      plannedTotalFee: 0,
      chargedAmount: 0,
      paidPercent: 0,
      paidSource: 'ESTIMATED',
      overdueDays: 0,
      behindSchedule: 0,
      items: [],
      totals: {
        totalItems: 0,
        plannedItems: 0,
        inProgressItems: 0,
        completedItems: 0,
        cancelledItems: 0,
        skippedItems: 0,
      },
      estimatedRemainingDays: 0,
      estimatedFinishDate: new Date().toISOString(),
    };
  }

  private computeFromRows(opts: {
    plan: InternalPlanRow;
    itemsRows: InternalItemRow[];
    thresholdDays: number;
  }): PlanProgressDetailDto {
    const { plan, itemsRows, thresholdDays } = opts;

    const totals: PlanProgressTotalsDto = {
      totalItems: itemsRows.length,
      plannedItems: 0,
      inProgressItems: 0,
      completedItems: 0,
      cancelledItems: 0,
      skippedItems: 0,
    };

    let completionNumerator = 0;
    const planCreated = this.parseDateSafe(plan.createdAt) ?? new Date();
    const today = new Date();
    let overdueDays = 0;

    const treatmentIds: string[] = itemsRows
      .map(r => r.treatmentId)
      .filter((id): id is string => !!id && id !== 'null' && id !== 'undefined');
    const treatmentMap = new Map<string, { id: string; status: string; completedDate?: string }>();
    if (treatmentIds.length > 0) {
      const placeholders = treatmentIds.map(() => '?').join(',');
      const { clause: tc, params: tp } = this.buildClinicClause();
      const tRows = this.dbService.prepare(
        `SELECT id, status, completedDate FROM Treatment
         WHERE id IN (${placeholders}) AND deletedAt IS NULL${tc}`
      ).all(...treatmentIds, ...tp) as Array<{ id: string; status: string; completedDate?: string }>;
      tRows.forEach(tr => treatmentMap.set(tr.id, tr));
    }

    const items: PlanProgressItemDto[] = itemsRows.map((row, idx) => {
      const status = row.status ?? 'PLANNED';
      if (status === 'PLANNED') totals.plannedItems++;
      else if (status === 'IN_PROGRESS') totals.inProgressItems++;
      else if (status === 'COMPLETED') totals.completedItems++;
      else if (status === 'CANCELLED') totals.cancelledItems++;
      else if (status === 'SKIPPED') totals.skippedItems++;

      const weight = STATUS_WEIGHT[status] ?? 0;
      completionNumerator += weight;

      const expectedDaysFromStart = (idx + 1) * AVG_DAYS_PER_ITEM;
      const expectedDate = new Date(planCreated.getTime() + expectedDaysFromStart * MS_PER_DAY);
      let daysLate = 0;
      if (status !== 'COMPLETED' && status !== 'SKIPPED' && status !== 'CANCELLED') {
        if (today.getTime() > expectedDate.getTime()) {
          const d = this.daysBetween(today, expectedDate);
          if (d > 0) {
            daysLate = d;
            overdueDays += daysLate;
          }
        }
      }

      const treatmentIdStr = row.treatmentId ?? undefined;
      const treatment = treatmentIdStr ? treatmentMap.get(treatmentIdStr) : undefined;
      const linkedTreatmentStatus = treatment ? treatment.status : undefined;
      let syncHint: string | undefined;
      if (treatment && linkedTreatmentStatus === 'COMPLETED' && status !== 'COMPLETED') {
        syncHint = '治疗已完成但未同步';
      }

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        category: row.category,
        plannedDate: this.toYmd(expectedDate),
        completedAt: row.completedAt ?? undefined,
        status,
        daysLate,
        treatmentId: treatmentIdStr,
        linkedTreatmentStatus,
        teethNumbers: safeJsonArray<number>(row.teethNumbers),
        syncHint,
        price: Number(row.price) || 0,
        quantity: Number(row.quantity) || 1,
      };
    });

    items.sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99;
      const sb = STATUS_ORDER[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return 0;
    });

    const totalForPercent = Math.max(1, items.length);
    const completionPercent = (completionNumerator / totalForPercent) * 100;
    const plannedTotalFee = Number(plan.totalFee) || 0;

    const { chargedAmount, paidSource } = this.computePaidAmountSync(plan);
    const paidPercent = plannedTotalFee > 0
      ? (chargedAmount / plannedTotalFee) * 100
      : 0;

    const behindSchedule = completionPercent < 80 && overdueDays >= thresholdDays ? 1 : 0;

    const remainingItems = totals.plannedItems + totals.inProgressItems;
    const estimatedRemainingDays = remainingItems * AVG_DAYS_PER_ITEM;
    const estimatedFinishDate = new Date(today.getTime() + estimatedRemainingDays * MS_PER_DAY).toISOString();

    return {
      planId: plan.id,
      planName: plan.name,
      planStatus: plan.status,
      planCreatedAt: plan.createdAt,
      completionPercent: Math.round(completionPercent * 10) / 10,
      plannedTotalFee,
      chargedAmount,
      paidPercent: Math.round(paidPercent * 10) / 10,
      paidSource,
      overdueDays,
      behindSchedule,
      items,
      totals,
      estimatedRemainingDays,
      estimatedFinishDate,
    };
  }

  private computePaidAmountSync(plan: InternalPlanRow): { chargedAmount: number; paidSource: 'REAL' | 'ESTIMATED' } {
    const { clause: cc, params: cp } = this.buildClinicClause(' AND ');
    const visitId = plan.visitId;
    let chargedAmount = 0;
    let hasRealCharge = false;

    if (visitId) {
      const rows = this.dbService.prepare(
        `SELECT paidAmount, refundedAmount FROM Charge
         WHERE visitId = ? AND deletedAt IS NULL${cc}`
      ).all(visitId, ...cp) as Array<{ paidAmount?: number; refundedAmount?: number }>;
      if (rows.length > 0) {
        let anyPaid = false;
        for (const r of rows) {
          const paid = Number(r.paidAmount) || 0;
          const refunded = Number(r.refundedAmount) || 0;
          if (paid > 0) anyPaid = true;
          chargedAmount += Math.max(0, paid - refunded);
        }
        hasRealCharge = rows.length > 0 && (chargedAmount > 0 || anyPaid);
      }
    }

    if (!hasRealCharge) {
      const planId = plan.id;
      const { clause: cc2, params: cp2 } = this.buildClinicClause(' AND ');
      const estimateRows = this.dbService.prepare(
        `SELECT status, price, quantity FROM TreatmentPlanItem
         WHERE planId = ? AND deletedAt IS NULL${cc2}`
      ).all(planId, ...cp2) as Array<{ status: string; price?: number; quantity?: number }>;
      for (const r of estimateRows) {
        if (r.status === 'COMPLETED') {
          const price = Number(r.price) || 0;
          const qty = Number(r.quantity) || 1;
          chargedAmount += price * qty;
        }
      }
      return { chargedAmount, paidSource: 'ESTIMATED' };
    }

    return { chargedAmount, paidSource: 'REAL' };
  }

  async doctorDashboard(opts: { doctorId?: string; fromDate?: string; toDate?: string }): Promise<DoctorBoardDto> {
    const enabled = await this.isEnabled();
    const emptyBoard: DoctorBoardDto = {
      doctorId: opts.doctorId,
      inProgressPlans: 0,
      totalPlans: 0,
      completedPlans: 0,
      planCompletionRate: 0,
      avgCompletion: 0,
      avgOverdueDays: 0,
      overdueTopPlans: [],
      expectedRevenue: 0,
      chargedRevenue: 0,
      revenueCompletionPercent: 0,
    };
    if (!enabled) return emptyBoard;

    const thresholdDays = await this.getOverdueThresholdDays();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const whereParts: string[] = ['deletedAt IS NULL'];
    const whereParams: unknown[] = [...clinicParams];
    if (clinicClause && clinicClause.trim() !== '') {
      whereParts.push('clinicId = ?');
    }
    if (opts.doctorId) {
      whereParts.push('doctorId = ?');
      whereParams.push(opts.doctorId);
    }
    if (opts.fromDate) {
      whereParts.push('createdAt >= ?');
      whereParams.push(opts.fromDate);
    }
    if (opts.toDate) {
      whereParts.push('createdAt <= ?');
      whereParams.push(opts.toDate);
    }
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const plans = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, name, status, totalFee, clinicId, createdAt
       FROM TreatmentPlan ${whereSql}`
    ).all(...whereParams) as InternalPlanRow[];

    if (plans.length === 0) return emptyBoard;

    let inProgressPlans = 0;
    let completedPlans = 0;
    let totalCompletion = 0;
    let totalOverdueDays = 0;
    let expectedRevenue = 0;
    let chargedRevenue = 0;
    const planProgresses: Array<{ plan: InternalPlanRow; detail: PlanProgressDetailDto }> = [];

    for (const plan of plans) {
      const itemsRows = this.dbService.prepare(
        `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status,
                treatmentId, completedAt, remark, clinicId
         FROM TreatmentPlanItem
         WHERE planId = ? AND deletedAt IS NULL
         ORDER BY id ASC`
      ).all(plan.id) as InternalItemRow[];

      const detail = this.computeFromRows({ plan, itemsRows, thresholdDays });
      planProgresses.push({ plan, detail });

      if (plan.status === 'IN_PROGRESS') inProgressPlans++;
      if (plan.status === 'COMPLETED') completedPlans++;

      totalCompletion += detail.completionPercent;
      totalOverdueDays += detail.overdueDays;
      expectedRevenue += Math.max(0, plan.totalFee || 0);
      chargedRevenue += detail.chargedAmount;
    }

    const totalPlans = plans.length;
    const planCompletionRate = (completedPlans / Math.max(1, totalPlans)) * 100;
    const avgCompletion = totalCompletion / Math.max(1, totalPlans);
    const avgOverdueDays = totalOverdueDays / Math.max(1, totalPlans);
    const revenueCompletionPercent = expectedRevenue > 0
      ? (chargedRevenue / expectedRevenue) * 100
      : 0;

    const sortedByOverdue = [...planProgresses]
      .filter(p => p.detail.overdueDays > 0)
      .sort((a, b) => b.detail.overdueDays - a.detail.overdueDays)
      .slice(0, 3);

    const overdueTopPlans: OverduePlanTopDto[] = sortedByOverdue.map(p => ({
      planId: p.plan.id,
      planName: p.plan.name,
      doctorId: p.plan.doctorId,
      completionPercent: p.detail.completionPercent,
      overdueDays: p.detail.overdueDays,
    }));

    return {
      doctorId: opts.doctorId,
      inProgressPlans,
      totalPlans,
      completedPlans,
      planCompletionRate: Math.round(planCompletionRate * 10) / 10,
      avgCompletion: Math.round(avgCompletion * 10) / 10,
      avgOverdueDays: Math.round(avgOverdueDays * 10) / 10,
      overdueTopPlans,
      expectedRevenue,
      chargedRevenue,
      revenueCompletionPercent: Math.round(revenueCompletionPercent * 10) / 10,
    };
  }

  async clinicDashboard(): Promise<ClinicBoardDto> {
    const enabled = await this.isEnabled();
    const emptyBoard: ClinicBoardDto = {
      totalPlans: 0,
      inProgressPlans: 0,
      completedPlans: 0,
      cancelledPlans: 0,
      submittedPlans: 0,
      approvedPlans: 0,
      weightedAvgCompletion: 0,
      plannedTotalRevenue: 0,
      chargedRevenue: 0,
      revenueCompletionPercent: 0,
      overdueTop5Plans: [],
    };
    if (!enabled) return emptyBoard;

    const thresholdDays = await this.getOverdueThresholdDays();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const plans = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, name, status, totalFee, clinicId, createdAt
       FROM TreatmentPlan WHERE deletedAt IS NULL${clinicClause}`
    ).all(...clinicParams) as InternalPlanRow[];

    if (plans.length === 0) return emptyBoard;

    let inProgressPlans = 0;
    let completedPlans = 0;
    let cancelledPlans = 0;
    let submittedPlans = 0;
    let approvedPlans = 0;
    let weightedCompletionSum = 0;
    let feeWeightSum = 0;
    let plannedTotalRevenue = 0;
    let chargedRevenue = 0;
    const withDetail: Array<{ plan: InternalPlanRow; detail: PlanProgressDetailDto }> = [];

    for (const plan of plans) {
      const status = plan.status;
      if (status === 'IN_PROGRESS') inProgressPlans++;
      else if (status === 'COMPLETED') completedPlans++;
      else if (status === 'CANCELLED') cancelledPlans++;
      else if (status === 'SUBMITTED') submittedPlans++;
      else if (status === 'APPROVED') approvedPlans++;

      const itemsRows = this.dbService.prepare(
        `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status,
                treatmentId, completedAt, remark, clinicId
         FROM TreatmentPlanItem
         WHERE planId = ? AND deletedAt IS NULL
         ORDER BY id ASC`
      ).all(plan.id) as InternalItemRow[];
      const detail = this.computeFromRows({ plan, itemsRows, thresholdDays });
      withDetail.push({ plan, detail });

      const fee = Math.max(0, plan.totalFee || 0);
      weightedCompletionSum += detail.completionPercent * fee;
      feeWeightSum += fee;
      plannedTotalRevenue += fee;
      chargedRevenue += detail.chargedAmount;
    }

    const weightedAvgCompletion = feeWeightSum > 0 ? (weightedCompletionSum / feeWeightSum) : 0;
    const revenueCompletionPercent = plannedTotalRevenue > 0
      ? (chargedRevenue / plannedTotalRevenue) * 100
      : 0;

    const overdueTop5Plans = [...withDetail]
      .sort((a, b) => b.detail.overdueDays - a.detail.overdueDays)
      .slice(0, 5)
      .filter(w => w.detail.overdueDays > 0)
      .map(w => ({
        planId: w.plan.id,
        planName: w.plan.name,
        doctorId: w.plan.doctorId,
        completionPercent: w.detail.completionPercent,
        overdueDays: w.detail.overdueDays,
        plannedTotalFee: w.plan.totalFee || 0,
      }));

    return {
      totalPlans: plans.length,
      inProgressPlans,
      completedPlans,
      cancelledPlans,
      submittedPlans,
      approvedPlans,
      weightedAvgCompletion: Math.round(weightedAvgCompletion * 10) / 10,
      plannedTotalRevenue,
      chargedRevenue,
      revenueCompletionPercent: Math.round(revenueCompletionPercent * 10) / 10,
      overdueTop5Plans,
    };
  }

  async snapshotToday(): Promise<{ written: number }> {
    const enabled = await this.isEnabled();
    if (!enabled) return { written: 0 };

    const thresholdDays = await this.getOverdueThresholdDays();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const today = new Date();
    const todayYmd = this.toYmd(today);

    const activePlans = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, name, status, totalFee, clinicId, createdAt
       FROM TreatmentPlan
       WHERE status IN ('IN_PROGRESS','SUBMITTED','APPROVED') AND deletedAt IS NULL${clinicClause}`
    ).all(...clinicParams) as InternalPlanRow[];

    if (activePlans.length === 0) return { written: 0 };

    const details: { plan: InternalPlanRow; detail: PlanProgressDetailDto }[] = [];
    for (const plan of activePlans) {
      const itemsRows = this.dbService.prepare(
        `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status,
                treatmentId, completedAt, remark, clinicId
         FROM TreatmentPlanItem
         WHERE planId = ? AND deletedAt IS NULL
         ORDER BY id ASC`
      ).all(plan.id) as InternalItemRow[];
      const detail = this.computeFromRows({ plan, itemsRows, thresholdDays });
      details.push({ plan, detail });
    }

    let written = 0;
    this.dbService.transaction((db) => {
      for (const { plan, detail } of details) {
        const existing = db.prepare(
          `SELECT id FROM TreatmentProgressSnapshot WHERE planId = ? AND snapshotDate = ?`
        ).get(plan.id, todayYmd) as { id: string } | undefined;

        const snapshotJson = JSON.stringify({
          totals: detail.totals,
          items: detail.items.map(i => ({ id: i.id, status: i.status, daysLate: i.daysLate })),
        });

        if (existing) {
          db.prepare(
            `UPDATE TreatmentProgressSnapshot SET
              plannedItems = ?, completedItems = ?, inProgressItems = ?,
              cancelledItems = ?, skippedItems = ?, plannedTotalFee = ?,
              chargedAmount = ?, completionPercent = ?, overdueDays = ?,
              behindSchedule = ?, snapshotJson = ?, createdAt = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(
            detail.totals.plannedItems,
            detail.totals.completedItems,
            detail.totals.inProgressItems,
            detail.totals.cancelledItems,
            detail.totals.skippedItems,
            detail.plannedTotalFee,
            detail.chargedAmount,
            detail.completionPercent,
            detail.overdueDays,
            detail.behindSchedule,
            snapshotJson,
            existing.id,
          );
        } else {
          const id = crypto.randomUUID();
          db.prepare(
            `INSERT INTO TreatmentProgressSnapshot (
              id, planId, clinicId, plannedItems, completedItems, inProgressItems,
              cancelledItems, skippedItems, plannedTotalFee, chargedAmount,
              completionPercent, overdueDays, behindSchedule, snapshotDate, snapshotJson
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).run(
            id, plan.id, plan.clinicId,
            detail.totals.plannedItems, detail.totals.completedItems, detail.totals.inProgressItems,
            detail.totals.cancelledItems, detail.totals.skippedItems,
            detail.plannedTotalFee, detail.chargedAmount,
            detail.completionPercent, detail.overdueDays, detail.behindSchedule,
            todayYmd, snapshotJson,
          );
        }
        written++;
      }
    });

    return { written };
  }

  async trend(days = 30): Promise<TrendPointDto[]> {
    const enabled = await this.isEnabled();
    if (!enabled) return [];

    const thresholdDays = await this.getOverdueThresholdDays();
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const today = new Date();
    const dates: string[] = [];
    for (let i = safeDays - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * MS_PER_DAY);
      dates.push(this.toYmd(d));
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const rows = this.dbService.prepare(
      `SELECT snapshotDate, completionPercent, overdueDays, planId
       FROM TreatmentProgressSnapshot
       WHERE 1=1${clinicClause}
       ORDER BY snapshotDate ASC`
    ).all(...clinicParams) as Array<{ snapshotDate: string; completionPercent?: number; overdueDays?: number; planId: string }>;

    const byDate: Map<string, Array<{ snapshotDate: string; completionPercent?: number; overdueDays?: number; planId: string }>> = new Map();
    for (const r of rows) {
      const d = r.snapshotDate;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(r);
    }

    const result: TrendPointDto[] = [];
    for (const date of dates) {
      const dateRows = byDate.get(date);
      if (dateRows && dateRows.length > 0) {
        let compSum = 0;
        let overdueCount = 0;
        const planSet = new Set<string>();
        for (const r of dateRows) {
          compSum += Number(r.completionPercent) || 0;
          if ((Number(r.overdueDays) || 0) > 0) overdueCount++;
          planSet.add(r.planId);
        }
        result.push({
          date,
          completionAvg: planSet.size > 0 ? Math.round((compSum / planSet.size) * 10) / 10 : 0,
          overduePlans: overdueCount,
          totalPlans: planSet.size,
        });
      } else {
        const livePoint = await this.computeLivePointForDate(date, thresholdDays);
        result.push(livePoint);
      }
    }
    return result;
  }

  private async computeLivePointForDate(dateYmd: string, thresholdDays: number): Promise<TrendPointDto> {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const createdBefore = dateYmd + 'T23:59:59.999';
    const plans = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, name, status, totalFee, clinicId, createdAt
       FROM TreatmentPlan
       WHERE createdAt <= ? AND deletedAt IS NULL${clinicClause}`
    ).all(createdBefore, ...clinicParams) as InternalPlanRow[];

    if (plans.length === 0) {
      return { date: dateYmd, completionAvg: 0, overduePlans: 0, totalPlans: 0 };
    }
    let compSum = 0;
    let overdueCount = 0;
    for (const plan of plans) {
      const itemsRows = this.dbService.prepare(
        `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status,
                treatmentId, completedAt, remark, clinicId
         FROM TreatmentPlanItem
         WHERE planId = ? AND deletedAt IS NULL
         ORDER BY id ASC`
      ).all(plan.id) as InternalItemRow[];
      const detail = this.computeFromRows({ plan, itemsRows, thresholdDays });
      compSum += detail.completionPercent;
      if (detail.overdueDays > 0) overdueCount++;
    }
    return {
      date: dateYmd,
      completionAvg: plans.length > 0 ? Math.round((compSum / plans.length) * 10) / 10 : 0,
      overduePlans: overdueCount,
      totalPlans: plans.length,
    };
  }

  async flagOverduePlan(planId: string, note?: string): Promise<{ planId: string; behindSchedule: number; note?: string }> {
    const enabled = await this.isEnabled();
    if (!enabled) {
      return { planId, behindSchedule: 0, note };
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const existing = this.dbService.prepare(
      `SELECT id FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(planId, ...clinicParams) as { id: string } | undefined;
    if (!existing) {
      return { planId, behindSchedule: 0, note };
    }

    this.dbService.transaction((db) => {
      this.auditLogService.logAudit(
        db,
        AuditLogType.PLAN_OVERDUE_FLAGGED,
        planId,
        'TreatmentPlan',
        this.clinicContext.getClinicId(),
        note ? { afterData: { note } } : undefined,
      );
    });

    return { planId, behindSchedule: 1, note };
  }
}
