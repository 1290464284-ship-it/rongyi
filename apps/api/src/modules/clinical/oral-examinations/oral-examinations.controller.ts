import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { OralExaminationsService } from './oral-examinations.service';
import { CreateOralExaminationDto } from './dto/create-oral-examination.dto';
import { QueryOralExaminationDto } from './dto/query-oral-examination.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('口腔检查')
@OperationLogResource('口腔检查')
@Controller('oral-examinations')
export class OralExaminationsController {
  constructor(private exams: OralExaminationsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query() q: QueryOralExaminationDto) {
    return this.exams.findMany({ filters: { patientId: q.patientId, visitId: q.visitId } });
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) { return this.exams.findOne(id); }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateOralExaminationDto) { return this.exams.create(dto); }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateOralExaminationDto>) { return this.exams.update(id, dto); }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) { return this.exams.remove(id); }
}
