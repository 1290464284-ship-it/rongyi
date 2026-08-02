import { Module } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController } from './prescriptions.controller';
import { DrugCatalogModule } from '../drug-catalog/drug-catalog.module';
import { PrescriptionSafetyModule } from '../prescription-safety/prescription-safety.module';

@Module({
  imports: [DrugCatalogModule, PrescriptionSafetyModule],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
