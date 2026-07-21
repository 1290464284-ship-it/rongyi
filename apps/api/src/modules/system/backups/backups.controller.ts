import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { BackupsService } from './backups.service';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS)
@ApiTags('备份恢复')
@Controller('backups')
export class BackupsController {
  constructor(private backups: BackupsService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Post()
  create(@Body() body: { type?: string; remark?: string }, @Request() req: ExpressRequest) {
    return this.backups.create(body.type, body.remark, req.user);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.backups.restoreById(id, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.backups.removeById(id);
  }

  @Post('drill')
  drill() {
    return this.backups.drill();
  }

  @Post(':id/verify')
  verify(@Param('id') id: string) {
    return this.backups.verifyBackup(id);
  }
}
