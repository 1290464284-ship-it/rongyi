import { Module } from '@nestjs/common';
import { CephalometricController, CephalometricAnalysisController } from './cephalometric.controller';
import { CephalometricService } from './cephalometric.service';
import { CephalometricMeasurementsService } from './measurements.service';
import { CephalometricClassificationService } from './classification.service';
import { CephalometricTemplateComparisonService } from './template-comparison.service';
import { CephalometricAnalysisService } from './analysis.service';
import { NormValueService } from './norm-value.service';
import { MetricsFormulaService } from './metrics-formula.service';
import { SettingsModule } from '../../system/settings/settings.module';
import { PrintModule } from '../../system/print/print.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';

@Module({
  imports: [SettingsModule, PrintModule, CommonServicesModule],
  controllers: [CephalometricController, CephalometricAnalysisController],
  providers: [
    CephalometricService,
    CephalometricMeasurementsService,
    CephalometricClassificationService,
    CephalometricTemplateComparisonService,
    CephalometricAnalysisService,
    NormValueService,
    MetricsFormulaService,
  ],
  exports: [
    CephalometricService,
    CephalometricMeasurementsService,
    CephalometricClassificationService,
    CephalometricTemplateComparisonService,
    CephalometricAnalysisService,
    NormValueService,
    MetricsFormulaService,
  ],
})
export class CephalometricModule {}
