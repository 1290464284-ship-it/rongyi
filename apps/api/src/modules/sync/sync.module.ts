import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { DbModule } from '../../db/db.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [DbModule, CommonModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
