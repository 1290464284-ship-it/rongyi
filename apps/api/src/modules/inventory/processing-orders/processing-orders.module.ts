import { Module } from '@nestjs/common';
import { ProcessingOrdersController } from './processing-orders.controller';
import { ProcessingOrdersService } from './processing-orders.service';

@Module({
  controllers: [ProcessingOrdersController],
  providers: [ProcessingOrdersService],
  exports: [ProcessingOrdersService],
})
export class ProcessingOrdersModule {}
