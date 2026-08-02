import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { ChargeAssistantService } from '../../../financial/charge-assistant/charge-assistant.service';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class ChargeAssistantRebuildTask implements DailyTaskHandler {
  readonly name = 'chargeAssistantRebuild';
  readonly enabled = true;
  readonly maxRetries = 1;
  private readonly logger = new AppLogger(ChargeAssistantRebuildTask.name);

  constructor(
    private readonly chargeAssistant: ChargeAssistantService,
    private readonly settingsService: SettingsService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    if (!clinicId) {
      this.logger.warn('[ChargeAssistantRebuild] 缺少 clinicId，跳过执行');
      return;
    }
    const enabled = await this.settingsService.getBoolean('aiChargeAssistantEnabled', true);
    if (!enabled) {
      this.logger.warn('[ChargeAssistantRebuild] aiChargeAssistantEnabled=false，跳过执行');
      return;
    }
    this.logger.log(`[ChargeAssistantRebuild] 开始执行 clinicId=${clinicId}`);
    try {
      const sinceDays = await this.settingsService.getNumber(
        'aiChargeAssociationLookbackDays',
        730,
      );
      const result = await this.chargeAssistant.rebuildRecommendations(
        sinceDays > 0 ? sinceDays : 730,
      );
      this.logger.log(
        `[ChargeAssistantRebuild] 完成 clinicId=${clinicId} ` +
        `transactions=${result.transactions} itemsets=${result.frequentItemsets} ` +
        `rules=${result.rules} added=${result.upsert.added} updated=${result.upsert.updated} ` +
        `deleted=${result.upsert.deleted} mockDemo=${result.mockDemoInserted}`
      );
    } catch (err: unknown) {
      this.logger.error(
        '[ChargeAssistantRebuild] 执行失败:',
        err instanceof Error ? err.stack ?? err.message : String(err)
      );
      throw err;
    }
  }
}
