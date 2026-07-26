import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupAutoService } from './backup-auto.service';
import { BackupManualService } from './backup-manual.service';
import { AlertService } from '../../../common/services/alert.service';

@Module({
  controllers: [BackupsController],
  providers: [BackupsService, BackupAutoService, BackupManualService, AlertService],
  exports: [BackupsService, BackupAutoService, BackupManualService, AlertService],
})
export class BackupsModule {}
