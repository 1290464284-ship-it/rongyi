import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { FollowUpsService } from './follow-ups.service';
import { CreateFollowupDto } from './dto/create-followup.dto';
import { UpdateFollowupDto } from './dto/update-followup.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('随访管理')
@OperationLogResource('随访')
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private followUpsService: FollowUpsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findAll() {
    return this.followUpsService.findAll();
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateFollowupDto) {
    return this.followUpsService.create(dto);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFollowupDto) {
    return this.followUpsService.update(id, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.followUpsService.remove(id);
  }

  @ApiOperation({ summary: 'complete - 随访' })
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: UpdateFollowupDto) {
    return this.followUpsService.complete(id, dto.result);
  }
}
