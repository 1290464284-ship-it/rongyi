import { Module } from '@nestjs/common';
import { ChargeController } from './charge.controller';
import { ChargeService } from './charge.service';
import { ChargePaymentService } from './charge-payment.service';
import { DebtService } from './debt.service';
import { ComboService } from './combo.service';
import { PaymentMethodService } from './payment-method.service';
import { ChargeRepository } from './repositories/charge.repository';
import { MemberCardsModule } from '../member-cards/member-cards.module';
import { StatsModule } from '../../system/stats/stats.module';

@Module({
  imports: [MemberCardsModule, StatsModule],
  controllers: [ChargeController],
  providers: [ChargeService, ChargePaymentService, DebtService, ComboService, PaymentMethodService, ChargeRepository],
})
export class ChargeModule {}
