import { Module } from '@nestjs/common';
import { MedicalPhraseService } from './medical-phrase.service';
import { MedicalPhraseController } from './medical-phrase.controller';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../../system/settings/settings.module';

@Module({
  imports: [DbModule, CommonServicesModule, SettingsModule],
  providers: [MedicalPhraseService],
  controllers: [MedicalPhraseController],
  exports: [MedicalPhraseService],
})
export class MedicalPhraseModule {}
