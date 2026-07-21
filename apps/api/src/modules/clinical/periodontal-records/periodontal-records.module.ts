import { Module } from '@nestjs/common';
import { PeriodontalRecordsController } from './periodontal-records.controller';
import { PeriodontalRecordsService } from './periodontal-records.service';

@Module({
  controllers: [PeriodontalRecordsController],
  providers: [PeriodontalRecordsService],
})
export class PeriodontalRecordsModule {}
