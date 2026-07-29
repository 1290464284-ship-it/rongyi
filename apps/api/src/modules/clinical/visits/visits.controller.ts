import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { QueryVisitDto } from './dto/query-visit.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('就诊管理')
@OperationLogResource('就诊')
@Controller('visits')
export class VisitsController {
  constructor(private visits: VisitsService) {}

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryVisitDto) {
    return this.visits.findMany(q);
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findOne(id);
  }

  @ApiOperation({ summary: 'complete - 接诊' })
  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteVisitDto) {
    return this.visits.complete(id, dto);
  }
}
