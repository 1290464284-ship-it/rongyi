 
import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { TreatmentProgressService } from '../../../clinical/treatment-progress/treatment-progress.service';
import { AlertCategory, AlertService } from '../../../../common/services/alert.service';

@Injectable()
export class TreatmentProgressSnapshotTask implements DailyTaskHandler {
  readonly name = 'TreatmentProgressSnapshot';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(TreatmentProgressSnapshotTask.name);

  constructor(
    private readonly treatmentProgressService?: TreatmentProgressService,
    private readonly alertService?: AlertService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    this.logger.log(`[TreatmentProgressSnapshot] 开始执行 snapshotToday clinicId=${clinicId ?? 'global'}`);
    if (!this.treatmentProgressService) {
      this.logger.log('[TreatmentProgressSnapshot] 未注入 service，跳过（测试模式）');
      return;
    }
    try {
      const result = await this.treatmentProgressService.snapshotToday();
      this.logger.log(
        `[TreatmentProgressSnapshot] 完成：written=${result.written}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack : String(err);
      this.logger.error('[TreatmentProgressSnapshot] 执行失败', msg);
      if (this.alertService) {
        try {
          this.alertService.recordFailure(
            AlertCategory.BUSINESS,
            'SCHEDULED_TASK_FAILED:TreatmentProgressSnapshot',
            '定时任务失败',
            `疗程进度快照任务失败：${err instanceof Error ? err.message : String(err)}`,
            { taskName: this.name, error: msg },
            clinicId,
          );
        } catch (alertErr: unknown) {
          this.logger.error(
            `[TreatmentProgressSnapshot] 写入 Alert 失败`,
            alertErr instanceof Error ? alertErr.stack : String(alertErr),
          );
        }
      }
      throw err;
    }
  }
}
