import { Module } from '@nestjs/common';
import { FirstExamsController } from './first-exams.controller';
import { FirstExamsService } from './first-exams.service';

@Module({
  controllers: [FirstExamsController],
  providers: [FirstExamsService],
})
export class FirstExamsModule {}
