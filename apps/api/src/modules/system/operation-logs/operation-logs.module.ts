import { Module } from '@nestjs/common';
import { OperationLogsController } from './operation-logs.controller';
import { OperationLogsService } from './operation-logs.service';
import { DbModule } from '../../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [OperationLogsController],
  providers: [OperationLogsService],
  exports: [OperationLogsService],
})
export class OperationLogsModule {}
