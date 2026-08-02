import { Module, forwardRef } from '@nestjs/common';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../settings/settings.module';
import { BusinessAlertModule } from '../business-alerts/business-alert.module';
import { FollowUpRecommenderModule } from '../../clinical/follow-up-recommender/follow-up-recommender.module';
import { ChargeAssistantModule } from '../../financial/charge-assistant/charge-assistant.module';
import { ReplenishmentSuggestionModule } from '../../inventory/replenishment-suggestion/replenishment-suggestion.module';
import { CustomerInsightsModule } from '../../analytics/customer-insights/customer-insights.module';
import { DoctorPerformanceModule } from '../../analytics/doctor-performance/performance-anomaly.module';
import { TreatmentProgressModule } from '../../clinical/treatment-progress/treatment-progress.module';
import { SatisfactionModule } from '../../analytics/satisfaction/satisfaction.module';
import { DailySchedulerService } from './daily-scheduler.service';
import { BusinessAlertDetectorTask } from './tasks/business-alert-detector.task';
import { InventoryReplenishmentTask } from './tasks/inventory-replenishment.task';
import { RfmAnalysisTask } from './tasks/rfm-analysis.task';
import { ChurnPredictionTask } from './tasks/churn-prediction.task';
import { DoctorPerfAnomalyTask } from './tasks/doctor-perf-anomaly.task';
import { FollowUpBatchGenTask } from './tasks/follow-up-batch-gen.task';
import { ChargeAssistantRebuildTask } from './tasks/charge-assistant-rebuild.task';
import { TreatmentProgressSnapshotTask } from './tasks/treatment-progress-snapshot.task';
import { NpsSnapshotTask } from './tasks/nps-snapshot.task';

@Module({
  imports: [
    CommonServicesModule,
    SettingsModule,
    BusinessAlertModule,
    FollowUpRecommenderModule,
    ChargeAssistantModule,
    CustomerInsightsModule,
    DoctorPerformanceModule,
    TreatmentProgressModule,
    SatisfactionModule,
    forwardRef(() => ReplenishmentSuggestionModule),
  ],
  providers: [
    DailySchedulerService,
    BusinessAlertDetectorTask,
    InventoryReplenishmentTask,
    RfmAnalysisTask,
    ChurnPredictionTask,
    DoctorPerfAnomalyTask,
    FollowUpBatchGenTask,
    ChargeAssistantRebuildTask,
    TreatmentProgressSnapshotTask,
    NpsSnapshotTask,
  ],
  exports: [DailySchedulerService],
})
export class DailySchedulerModule {}
