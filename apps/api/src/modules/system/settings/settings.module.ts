import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DbModule } from '../../../db/db.module';
import { CacheService } from '../../../common/services/cache.service';

@Module({
  imports: [DbModule],
  controllers: [SettingsController],
  providers: [SettingsService, CacheService],
})
export class SettingsModule {}
