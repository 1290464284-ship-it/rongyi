import { Module } from '@nestjs/common';
import { OralExaminationsController } from './oral-examinations.controller';
import { OralExaminationsService } from './oral-examinations.service';

@Module({
  controllers: [OralExaminationsController],
  providers: [OralExaminationsService],
})
export class OralExaminationsModule {}
