import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { SettingsService } from './settings.service';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS)
@ApiTags('系统设置')
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  findAll() {
    return this.settings.findAll();
  }

  @Patch()
  upsertMany(@Body() body: Record<string, string>) {
    return this.settings.upsertMany(body);
  }
}
