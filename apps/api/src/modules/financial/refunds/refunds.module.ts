import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';

@Module({
  controllers: [RefundsController],
  providers: [RefundsService, IdempotencyService],
  exports: [RefundsService],
})
export class RefundsModule {}
