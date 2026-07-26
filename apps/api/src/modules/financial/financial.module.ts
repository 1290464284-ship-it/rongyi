import { Module } from '@nestjs/common';
import { ChargeModule } from './charge/charge.module';
import { RefundsModule } from './refunds/refunds.module';
import { MemberCardsModule } from './member-cards/member-cards.module';

@Module({
  imports: [ChargeModule, RefundsModule, MemberCardsModule],
})
export class FinancialModule {}
