import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { CustomerInsightsService } from '../../../analytics/customer-insights/customer-insights.service';

@Injectable()
export class ChurnPredictionTask implements DailyTaskHandler {
  readonly name = 'ChurnPrediction';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(ChurnPredictionTask.name);

  constructor(
    private customerInsightsService?: CustomerInsightsService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    this.logger.log(`[ChurnPrediction] 与 RFM 同步执行（复用 batchComputeRfm 内部 churn 计算逻辑） clinicId=${clinicId ?? 'global'}`);
    if (!this.customerInsightsService) {
      this.logger.log('[ChurnPrediction] 未注入 service，跳过（测试模式）');
      return;
    }
    try {
      const result = await this.customerInsightsService.batchComputeRfm(500);
      this.logger.log(
        `[ChurnPrediction] 完成：processed=${result.processed}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack : String(err);
      this.logger.error('[ChurnPrediction] 执行失败', msg);
      throw err;
    }
  }
}
