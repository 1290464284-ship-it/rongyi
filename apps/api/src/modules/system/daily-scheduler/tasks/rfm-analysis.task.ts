import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { CustomerInsightsService } from '../../../analytics/customer-insights/customer-insights.service';

@Injectable()
export class RfmAnalysisTask implements DailyTaskHandler {
  readonly name = 'RfmAnalysis';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(RfmAnalysisTask.name);

  constructor(
    private customerInsightsService?: CustomerInsightsService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    this.logger.log(`[RfmAnalysis] 开始执行 batchComputeRfm clinicId=${clinicId ?? 'global'}`);
    if (!this.customerInsightsService) {
      this.logger.log('[RfmAnalysis] 未注入 service，跳过（测试模式）');
      return;
    }
    try {
      const result = await this.customerInsightsService.batchComputeRfm(1000);
      const totalSegments = Object.values(result.segmentBreakdown).reduce((s, n) => s + n, 0);
      this.logger.log(
        `[RfmAnalysis] 完成：processed=${result.processed}, ` +
        `segmentsTotal=${totalSegments}, ` +
        `breakdown=${JSON.stringify(result.segmentBreakdown)}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack : String(err);
      this.logger.error('[RfmAnalysis] 执行失败', msg);
      throw err;
    }
  }
}
