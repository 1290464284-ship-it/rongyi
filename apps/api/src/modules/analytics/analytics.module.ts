import { Module } from '@nestjs/common';
import { CustomerInsightsModule } from './customer-insights/customer-insights.module';
import { DoctorPerformanceModule } from './doctor-performance/performance-anomaly.module';
import { SatisfactionModule } from './satisfaction/satisfaction.module';

@Module({
  imports: [CustomerInsightsModule, DoctorPerformanceModule, SatisfactionModule],
  exports: [CustomerInsightsModule, DoctorPerformanceModule, SatisfactionModule],
})
export class AnalyticsModule {}
