import { Module } from '@nestjs/common';
import { ImagingController } from './imaging.controller';
import { ImagingService } from './imaging.service';

@Module({
  controllers: [ImagingController],
  providers: [ImagingService],
})
export class ImagingModule {}
