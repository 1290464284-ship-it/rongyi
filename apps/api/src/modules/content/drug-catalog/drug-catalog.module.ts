import { Module } from '@nestjs/common';
import { DrugCatalogService } from './drug-catalog.service';
import { CommonServicesModule } from '../../../common/services/common-services.module';

@Module({
  imports: [CommonServicesModule],
  providers: [DrugCatalogService],
  exports: [DrugCatalogService],
})
export class DrugCatalogModule {}
