import { Injectable } from '@nestjs/common';
import { DailyTaskHandler } from '../task-handler.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { BusinessAlertDetectorService } from '../../business-alerts/business-alert-detector.service';

function getLastFullMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class BusinessAlertDetectorTask implements DailyTaskHandler {
  readonly name = 'BusinessAlertDetector';
  readonly enabled = true;
  readonly maxRetries = 3;
  private readonly logger = new AppLogger(BusinessAlertDetectorTask.name);

  constructor(
    private readonly businessAlertDetector: BusinessAlertDetectorService,
  ) {}

  async execute(clinicId?: string): Promise<void> {
    if (!clinicId) {
      this.logger.warn('[BusinessAlertDetector] 缺少 clinicId，跳过执行');
      return;
    }
    const runMonth = getLastFullMonth();
    this.logger.log(`[BusinessAlertDetector] 开始执行 clinicId=${clinicId} runMonth=${runMonth}`);
    try {
      const results = await this.businessAlertDetector.detectForClinic(clinicId, { runMonth });
      this.logger.log(`[BusinessAlertDetector] 执行完成 clinicId=${clinicId} 触发预警 ${results.length} 条`);
    } catch (err: unknown) {
      this.logger.error('[BusinessAlertDetector] 执行失败:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}
