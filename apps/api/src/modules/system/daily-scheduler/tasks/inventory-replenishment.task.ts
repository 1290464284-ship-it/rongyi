import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { ReplenishmentSuggestionService } from '../../../inventory/replenishment-suggestion/replenishment-suggestion.service';
import { ClinicContextService } from '../../../../common/services/clinic-context.service';

@Injectable()
export class InventoryReplenishmentTask implements DailyTaskHandler {
  readonly name = 'InventoryReplenishment';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(InventoryReplenishmentTask.name);

  constructor(
    private readonly suggestionService: ReplenishmentSuggestionService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    this.logger.log(`[InventoryReplenishment] 开始执行 clinicId=${clinicId ?? 'global'}`);
    if (clinicId) {
      this.clinicContext.run({
        clinicId,
        userId: null,
        role: null,
        userAgent: null,
        source: 'scheduler',
      }, async () => {
        const result = await this.suggestionService.generateSuggestions();
        const s = result.stats;
        this.logger.log(
          `[InventoryReplenishment] 完成 clinicId=${clinicId} scanned=${s.scanned} generated=${s.generated} zeroStock=${s.zeroStock} expiring=${s.expiring} spike=${s.spike}`,
        );
      });
    } else {
      const result = await this.suggestionService.generateSuggestions();
      const s = result.stats;
      this.logger.log(
        `[InventoryReplenishment] 完成 scanned=${s.scanned} generated=${s.generated} zeroStock=${s.zeroStock} expiring=${s.expiring} spike=${s.spike}`,
      );
    }
  }
}

