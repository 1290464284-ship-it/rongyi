import { Body, Controller, Delete, Get, Param, Post, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { BackupsService } from './backups.service';
import { AlertService, AlertLevel, AlertCategory } from '../../../common/services/alert.service';

class CreateBackupDto {
  @IsOptional()
  @IsString()
  @IsIn(['manual', 'auto', 'pre-upgrade'])
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

@Roles(Role.BOSS)
@ApiTags('备份恢复')
@OperationLogResource('备份')
@Controller('backups')
export class BackupsController {
  constructor(
    private backups: BackupsService,
    private alertService: AlertService,
  ) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  list() {
    return this.backups.list();
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateBackupDto, @Request() req: ExpressRequest) {
    return this.backups.create(dto.type, dto.remark, req.user ?? {});
  }

  @ApiOperation({ summary: 'restore - 备份' })
  @Post(':id/restore')
  restore(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.backups.restoreById(id, req.user ?? {});
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.backups.removeById(id);
  }

  @ApiOperation({ summary: 'drill - 备份' })
  @Post('drill')
  drill() {
    return this.backups.drill();
  }

  @ApiOperation({ summary: '验证备份' })
  @Post(':id/verify')
  verify(@Param('id') id: string) {
    return this.backups.verifyBackup(id);
  }

  @ApiOperation({ summary: '获取备份' })
  @Get('alerts/list')
  getAlerts(
    @Query('level') level?: AlertLevel,
    @Query('category') category?: AlertCategory,
    @Query('resolved') resolved?: string,
    @Query('limit') limit?: string,
  ) {
    return this.alertService.getAlerts({
      level,
      category,
      resolved: resolved !== undefined ? resolved === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @ApiOperation({ summary: 'resolveAlert - 备份' })
  @Post('alerts/:id/resolve')
  resolveAlert(@Param('id') id: string) {
    const success = this.alertService.resolveAlert(id);
    return { success };
  }

  @ApiOperation({ summary: 'clearResolvedAlerts - 备份' })
  @Post('alerts/clear-resolved')
  clearResolvedAlerts() {
    this.alertService.clearResolved();
    return { success: true };
  }
}
