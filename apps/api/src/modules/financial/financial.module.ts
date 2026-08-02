import { Module } from '@nestjs/common';
import { ChargeModule } from './charge/charge.module';
import { RefundsModule } from './refunds/refunds.module';
import { MemberCardsModule } from './member-cards/member-cards.module';
import { ChargeAssistantModule } from './charge-assistant/charge-assistant.module';

@Module({
  imports: [ChargeModule, RefundsModule, MemberCardsModule, ChargeAssistantModule],
})
export class FinancialModule {}
