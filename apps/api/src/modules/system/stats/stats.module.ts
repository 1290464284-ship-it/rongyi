import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { CacheService } from '../../../common/services/cache.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, CacheService],
  exports: [StatsService],
})
export class StatsModule {}
