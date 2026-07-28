import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { CodeGenerator } from './code-generator.service';
import { SoftDeleteManager } from './soft-delete-manager.service';
import { PaginationService } from './pagination.service';
import { BaseRepository } from '../repositories/base.repository';

@Module({
  providers: [
    AuditLogService,
    CodeGenerator,
    SoftDeleteManager,
    PaginationService,
    BaseRepository,
  ],
  exports: [
    AuditLogService,
    CodeGenerator,
    SoftDeleteManager,
    PaginationService,
    BaseRepository,
  ],
})
export class CommonServicesModule {}
