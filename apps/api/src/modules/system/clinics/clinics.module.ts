import { Module } from '@nestjs/common';
import { ClinicsController } from './clinics.controller';
import { ClinicsService } from './clinics.service';
import { DbModule } from '../../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [ClinicsController],
  providers: [ClinicsService],
})
export class ClinicsModule {}
