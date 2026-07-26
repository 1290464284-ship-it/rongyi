import { Module } from '@nestjs/common';
import { ToothRecordsController } from './tooth-records.controller';
import { ToothRecordsService } from './tooth-records.service';

@Module({
  controllers: [ToothRecordsController],
  providers: [ToothRecordsService],
  exports: [ToothRecordsService],
})
export class ToothRecordsModule {}
