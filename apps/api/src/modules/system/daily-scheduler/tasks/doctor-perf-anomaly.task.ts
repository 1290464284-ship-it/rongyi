import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { PerformanceAnomalyService } from '../../../analytics/doctor-performance/performance-anomaly.service';

@Injectable()
export class DoctorPerfAnomalyTask implements DailyTaskHandler {
  readonly name = 'DoctorPerfAnomaly';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(DoctorPerfAnomalyTask.name);

  constructor(
    private performanceAnomalyService?: PerformanceAnomalyService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    this.logger.log(`[DoctorPerfAnomaly] 开始执行 batchDetectAnomalies clinicId=${clinicId ?? 'global'}`);
    if (!this.performanceAnomalyService) {
      this.logger.log('[DoctorPerfAnomaly] 未注入 service，跳过（测试模式）');
      return;
    }
    try {
      const result = await this.performanceAnomalyService.batchDetectAnomalies();
      this.logger.log(
        `[DoctorPerfAnomaly] 完成：scanned=${result.scanned}, ` +
        `detectedWarn=${result.detectedWarn}, detectedCritical=${result.detectedCritical}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack : String(err);
      this.logger.error('[DoctorPerfAnomaly] 执行失败', msg);
      throw err;
    }
  }
}
