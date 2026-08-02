import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DailyTaskHandler } from './task-handler.interface';
import { AppLogger } from '../../../common/services/logger.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessAlertDetectorTask } from './tasks/business-alert-detector.task';
import { InventoryReplenishmentTask } from './tasks/inventory-replenishment.task';
import { RfmAnalysisTask } from './tasks/rfm-analysis.task';
import { ChurnPredictionTask } from './tasks/churn-prediction.task';
import { DoctorPerfAnomalyTask } from './tasks/doctor-perf-anomaly.task';
import { FollowUpBatchGenTask } from './tasks/follow-up-batch-gen.task';
import { ChargeAssistantRebuildTask } from './tasks/charge-assistant-rebuild.task';
import { TreatmentProgressSnapshotTask } from './tasks/treatment-progress-snapshot.task';
import { NpsSnapshotTask } from './tasks/nps-snapshot.task';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;

@Injectable()
export class DailySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(DailySchedulerService.name);
  private handlers: DailyTaskHandler[] = [];
  private failureCounters: Map<string, number> = new Map();
  private initialTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private schedulerEnabled = true;
  private targetHour = 3;
  private targetMinute = 25;

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private settingsService: SettingsService,
    private businessAlertDetectorTask: BusinessAlertDetectorTask,
    private inventoryReplenishmentTask: InventoryReplenishmentTask,
    private rfmAnalysisTask: RfmAnalysisTask,
    private churnPredictionTask: ChurnPredictionTask,
    private doctorPerfAnomalyTask: DoctorPerfAnomalyTask,
    private followUpBatchGenTask: FollowUpBatchGenTask,
    private chargeAssistantRebuildTask: ChargeAssistantRebuildTask,
    private treatmentProgressSnapshotTask: TreatmentProgressSnapshotTask,
    private npsSnapshotTask: NpsSnapshotTask,
  ) {
    this.register(businessAlertDetectorTask);
    this.register(inventoryReplenishmentTask);
    this.register(rfmAnalysisTask);
    this.register(churnPredictionTask);
    this.register(doctorPerfAnomalyTask);
    this.register(followUpBatchGenTask);
    this.register(chargeAssistantRebuildTask);
    this.register(treatmentProgressSnapshotTask);
    this.register(npsSnapshotTask);
  }

  register(handler: DailyTaskHandler): void {
    this.handlers.push(handler);
  }

  async onModuleInit(): Promise<void> {
    try {
      const enabled = await this.settingsService.get('dailySchedulerEnabled');
      this.schedulerEnabled = enabled !== 'false';

      if (!this.schedulerEnabled) {
        this.logger.warn('[DailyScheduler] 调度器已禁用（dailySchedulerEnabled=false），不启动定时任务');
        return;
      }

      const hourStr = await this.settingsService.get('dailySchedulerHour');
      const minuteStr = await this.settingsService.get('dailySchedulerMinute');
      this.targetHour = hourStr ? parseInt(hourStr, 10) : 3;
      this.targetMinute = minuteStr ? parseInt(minuteStr, 10) : 25;

      if (isNaN(this.targetHour) || this.targetHour < 0 || this.targetHour > 23) {
        this.targetHour = 3;
      }
      if (isNaN(this.targetMinute) || this.targetMinute < 0 || this.targetMinute > 59) {
        this.targetMinute = 25;
      }

      const handlerNames = this.handlers.map((h) => h.name);
      this.logger.log(
        `[DailyScheduler] 调度器已启动，每日执行时间 ${this.formatHourMinute(this.targetHour, this.targetMinute)}，` +
        `已注册 ${this.handlers.length} 个子任务: [${handlerNames.join(',')}]`
      );

      this.scheduleNextRun();
    } catch (err: unknown) {
      this.logger.error(
        '[DailyScheduler] 初始化调度器失败',
        err instanceof Error ? err.stack : String(err)
      );
    }
  }

  onModuleDestroy(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.logger.log('[DailyScheduler] 调度器已停止');
  }

  private formatHourMinute(hour: number, minute: number): string {
    const h = hour.toString().padStart(2, '0');
    const m = minute.toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private calculateMsUntilNextRun(): number {
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(this.targetHour, this.targetMinute, 0, 0);

    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun.getTime() - now.getTime();
  }

  private scheduleNextRun(): void {
    const msUntilNextRun = this.calculateMsUntilNextRun();
    this.logger.log(`[DailyScheduler] 距离下一次执行还有 ${msUntilNextRun}ms (${(msUntilNextRun / 3600000).toFixed(2)}小时)`);

    this.initialTimer = setTimeout(() => {
      this.runAllTasks().catch((err) => {
        this.logger.error(
          '[DailyScheduler] 执行定时任务集合失败',
          err instanceof Error ? err.stack : String(err)
        );
      });

      this.intervalTimer = setInterval(() => {
        this.runAllTasks().catch((err) => {
          this.logger.error(
            '[DailyScheduler] 执行定时任务集合失败',
            err instanceof Error ? err.stack : String(err)
          );
        });
      }, ONE_DAY_MS);
    }, msUntilNextRun);
  }

  async runAllTasks(): Promise<void> {
    const clinicId = this.clinicContext.getClinicId() ?? undefined;
    this.logger.log(`[DailyScheduler] 开始执行所有子任务 clinicId=${clinicId ?? 'global'}`);

    for (const handler of this.handlers) {
      if (handler.enabled === false) {
        this.logger.log(`[DailyScheduler] 跳过已禁用的子任务: ${handler.name}`);
        continue;
      }

      try {
        this.logger.log(`[DailyScheduler] 执行子任务: ${handler.name}`);
        await handler.execute(clinicId);
        this.failureCounters.set(handler.name, 0);
        this.logger.log(`[DailyScheduler] 子任务执行成功: ${handler.name}`);
      } catch (err: unknown) {
        const currentCount = (this.failureCounters.get(handler.name) || 0) + 1;
        this.failureCounters.set(handler.name, currentCount);

        const errMsg = err instanceof Error ? err.stack : String(err);
        this.logger.error(
          `[DailyScheduler] 子任务执行失败: ${handler.name} (连续失败 ${currentCount} 次)`,
          errMsg
        );

        if (currentCount >= MAX_CONSECUTIVE_FAILURES) {
          try {
            this.writeBusinessAlert(handler.name, clinicId);
          } catch (alertErr: unknown) {
            this.logger.error(
              `[DailyScheduler] 写入 BusinessAlert 失败: ${handler.name}`,
              alertErr instanceof Error ? alertErr.stack : String(alertErr)
            );
          }
        }
      }
    }

    this.logger.log('[DailyScheduler] 所有子任务执行完成');
  }

  getFailureCount(handlerName: string): number {
    return this.failureCounters.get(handlerName) || 0;
  }

  resetFailureCount(handlerName: string): void {
    this.failureCounters.set(handlerName, 0);
  }

  private writeBusinessAlert(handlerName: string, clinicId?: string): void {
    const id = crypto.randomUUID();
    const resolvedClinicId = clinicId ?? this.clinicContext.getClinicId() ?? 'global';
    const now = new Date().toISOString();
    const message = `子任务${handlerName}连续失败3次，请检查日志`;
    const suggestion = '查看 logs/daily-scheduler.log 或 Nest 控制台错误栈';

    this.dbService.prepare(
      `INSERT INTO BusinessAlert (
        id, clinicId, alertType, severity, metricName,
        currentValue, baselineValue, deviationPercent,
        message, suggestion, acknowledged, occurredAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      id,
      resolvedClinicId,
      'SCHEDULER_TASK_FAILURE',
      'CRITICAL',
      handlerName,
      null,
      null,
      null,
      message,
      suggestion,
      now,
      now,
      now
    );

    this.logger.error(
      `[DailyScheduler] 已写入 CRITICAL 告警到 BusinessAlert: ${handlerName} 连续失败${MAX_CONSECUTIVE_FAILURES}次`
    );
  }
}
