import { Module, forwardRef } from '@nestjs/common';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../../system/settings/settings.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { ReplenishmentSuggestionService } from './replenishment-suggestion.service';
import { ReplenishmentSuggestionController } from './replenishment-suggestion.controller';

@Module({
  imports: [CommonServicesModule, SettingsModule, forwardRef(() => PurchaseOrdersModule)],
  controllers: [ReplenishmentSuggestionController],
  providers: [ReplenishmentSuggestionService],
  exports: [ReplenishmentSuggestionService],
})
export class ReplenishmentSuggestionModule {}
