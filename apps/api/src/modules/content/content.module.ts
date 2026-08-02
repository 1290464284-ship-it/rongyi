import { Module } from '@nestjs/common';
import { ToothRecordsModule } from './tooth-records/tooth-records.module';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';
import { ImagingModule } from './imaging/imaging.module';
import { DrugCatalogModule } from './drug-catalog/drug-catalog.module';
import { MedicalPhraseModule } from './medical-phrase/medical-phrase.module';

@Module({
  imports: [ToothRecordsModule, PrescriptionsModule, ImagingModule, DrugCatalogModule, MedicalPhraseModule],
})
export class ContentModule {}
