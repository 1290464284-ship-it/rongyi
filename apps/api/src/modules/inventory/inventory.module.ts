import { Module } from '@nestjs/common';
import { InventoryModule as InventoryItemsModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { ProcessingOrdersModule } from './processing-orders/processing-orders.module';
import { ReplenishmentSuggestionModule } from './replenishment-suggestion/replenishment-suggestion.module';

@Module({
  imports: [InventoryItemsModule, SuppliersModule, PurchaseOrdersModule, ProcessingOrdersModule, ReplenishmentSuggestionModule],
})
export class InventoryModule {}
