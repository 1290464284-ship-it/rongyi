import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { MedicalSummaryModule } from '../medical-summary/medical-summary.module';

@Module({
  imports: [MedicalSummaryModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
