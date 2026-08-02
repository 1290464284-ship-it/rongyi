import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { FollowUpRecommenderService } from '../../../clinical/follow-up-recommender/follow-up-recommender.service';

@Injectable()
export class FollowUpBatchGenTask implements DailyTaskHandler {
  readonly name = 'followUpBatchGen';
  readonly enabled = true;
  readonly maxRetries = 2;
  private readonly logger = new AppLogger(FollowUpBatchGenTask.name);

  constructor(
    private readonly followUpRecommender: FollowUpRecommenderService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    if (!clinicId) {
      this.logger.warn('[FollowUpBatchGen] 缺少 clinicId，跳过执行');
      return;
    }
    this.logger.log(`[FollowUpBatchGen] 开始执行 clinicId=${clinicId}`);
    try {
      const result = await this.followUpRecommender.batchGenerate(200);
      this.logger.log(
        `[FollowUpBatchGen] 执行完成 clinicId=${clinicId} ` +
        `processed=${result.totalProcessed} generated=${result.totalGenerated} skipped=${result.skippedDueToExisting}`,
      );
    } catch (err: unknown) {
      this.logger.error('[FollowUpBatchGen] 执行失败:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}
