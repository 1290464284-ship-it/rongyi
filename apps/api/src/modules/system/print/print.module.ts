import { Module, forwardRef } from '@nestjs/common';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { TemplateEngineService } from './template-engine.service';
import { PrintTemplateService } from './print-template.service';
import { PrintService } from './print.service';
import { PrintController } from './print.controller';
import { SettingsModule } from '../settings/settings.module';
import { ClinicsModule } from '../clinics/clinics.module';

@Module({
  imports: [
    DbModule,
    CommonServicesModule,
    forwardRef(() => SettingsModule),
    forwardRef(() => ClinicsModule),
  ],
  controllers: [PrintController],
  providers: [TemplateEngineService, PrintTemplateService, PrintService],
  exports: [TemplateEngineService, PrintTemplateService, PrintService],
})
export class PrintModule {}
