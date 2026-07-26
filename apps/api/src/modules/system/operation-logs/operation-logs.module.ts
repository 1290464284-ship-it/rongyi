import { Module } from '@nestjs/common';
import { OperationLogsController } from './operation-logs.controller';
import { OperationLogsService } from './operation-logs.service';
import { DbModule } from '../../../db/db.module';
import { OPERATION_LOG_SINK } from '../../../common/services/operation-log-sink.interface';

@Module({
  imports: [DbModule],
  controllers: [OperationLogsController],
  providers: [
    OperationLogsService,
    { provide: OPERATION_LOG_SINK, useExisting: OperationLogsService },
  ],
  exports: [OperationLogsService, OPERATION_LOG_SINK],
})
export class OperationLogsModule {}
