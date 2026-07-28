import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { RefundRepository } from './repositories/refund.repository';
import { StatsModule } from '../../system/stats/stats.module';

@Module({
  imports: [StatsModule],
  controllers: [RefundsController],
  providers: [RefundsService, RefundRepository],
  exports: [RefundsService],
})
export class RefundsModule {}
