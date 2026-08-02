import { Module } from '@nestjs/common';
import { CephalometricModule } from './cephalometric/cephalometric.module';

@Module({
  imports: [CephalometricModule],
  exports: [CephalometricModule],
})
export class OrthodonticsModule {}
