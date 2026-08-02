import { Module } from '@nestjs/common';
import { MedicalSummaryService } from './medical-summary.service';
import { SettingsModule } from '../../system/settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [MedicalSummaryService],
  exports: [MedicalSummaryService],
})
export class MedicalSummaryModule {}
