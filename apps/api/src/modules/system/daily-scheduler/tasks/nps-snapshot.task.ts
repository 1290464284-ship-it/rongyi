import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { SatisfactionService } from '../../../analytics/satisfaction/satisfaction.service';
import * as crypto from 'node:crypto';
import { DbService } from '../../../../db/db.service';

@Injectable()
export class NpsSnapshotTask implements DailyTaskHandler {
  readonly name = 'NpsSnapshot';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(NpsSnapshotTask.name);

  constructor(
    private readonly satisfactionService: SatisfactionService,
    private readonly dbService: DbService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    this.logger.log(`[NpsSnapshot] 开始执行 snapshotDaily clinicId=${clinicId ?? 'global'}`);
    try {
      const result = await this.satisfactionService.snapshotDaily();
      this.logger.log(
        `[NpsSnapshot] 完成：written=${result.written}, date=${result.snapshotDate}, nps=${result.nps}, total=${result.totalResponses}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack : String(err);
      this.logger.error('[NpsSnapshot] 执行失败', msg);
      try {
        const resolvedClinicId = clinicId ?? 'global';
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const message = `NPS每日快照任务失败：${err instanceof Error ? err.message : String(err)}`;
        const suggestion = '检查 satisfaction.service 错误栈与诊所数据';
        this.dbService.prepare(
          `INSERT INTO BusinessAlert (
            id, clinicId, alertType, severity, metricName,
            currentValue, baselineValue, deviationPercent,
            message, suggestion, acknowledged, occurredAt, createdAt, updatedAt
          ) VALUES (?, ?, 'SCHEDULER_TASK_FAILURE', 'CRITICAL', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        ).run(
          id,
          resolvedClinicId,
          this.name,
          null,
          null,
          null,
          message,
          suggestion,
          now,
          now,
          now
        );
      } catch (alertErr: unknown) {
        this.logger.error(
          `[NpsSnapshot] 写入 BusinessAlert 失败`,
          alertErr instanceof Error ? alertErr.stack : String(alertErr),
        );
      }
      throw err;
    }
  }
}
