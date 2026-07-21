import { Module } from '@nestjs/common';
import { ChairsController } from './chairs.controller';
import { ChairsService } from './chairs.service';
import { DbModule } from '../../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [ChairsController],
  providers: [ChairsService],
})
export class ChairsModule {}
