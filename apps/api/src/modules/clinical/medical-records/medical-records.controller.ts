import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { MedicalRecordsService } from './medical-records.service';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';
import { UpdateMedicalRecordDto } from './dto/update-medical-record.dto';
import { QueryMedicalRecordDto } from './dto/query-medical-record.dto';
import { CreateRecordTemplateDto } from './dto/create-record-template.dto';
import { CreateRecordPhraseDto } from './dto/create-record-phrase.dto';
import { CreateModifyRequestDto, ReviewModifyRequestDto } from './dto/modify-request.dto';

@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('病历管理')
@OperationLogResource('病历')
@Controller('medical-records')
export class MedicalRecordsController {
  constructor(private records: MedicalRecordsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findAll(@Query() q: QueryMedicalRecordDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.records.queryRecords({
      patientId: q.patientId,
      visitId: q.visitId,
      page: safePage(page),
      pageSize: safePageSize(pageSize, 50),
    });
  }

  // P0 修复：静态路径（templates/phrases/modify-requests）必须声明在 @Get(':id') 之前，
  // 否则 NestJS/Express 按注册顺序匹配，GET /medical-records/templates 会被 :id 捕获（id='templates'），
  // 导致模板/短语/修改请求接口完全失效。

  @ApiOperation({ summary: '查询病历列表' })
  @Get('templates')
  listTemplates(@Query('category') category: string, @Request() req: ExpressRequest) {
    return this.records.listTemplates(req.user?.id, category);
  }

  @ApiOperation({ summary: '创建病历' })
  @Post('templates')
  createTemplate(@Body() dto: CreateRecordTemplateDto, @Request() req: ExpressRequest) {
    return this.records.createTemplate(dto, req.user?.id);
  }

  @ApiOperation({ summary: '更新病历' })
  @Patch('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: Partial<CreateRecordTemplateDto>, @Request() req: ExpressRequest) {
    return this.records.updateTemplate(id, dto, req.user?.id);
  }

  @ApiOperation({ summary: '删除病历' })
  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.records.deleteTemplate(id, req.user?.id);
  }

  @ApiOperation({ summary: '查询病历列表' })
  @Get('phrases')
  listPhrases(@Query('category') category: string, @Request() req: ExpressRequest) {
    return this.records.listPhrases(req.user?.id, category);
  }

  @ApiOperation({ summary: '创建病历' })
  @Post('phrases')
  createPhrase(@Body() dto: CreateRecordPhraseDto, @Request() req: ExpressRequest) {
    return this.records.createPhrase(dto, req.user?.id);
  }

  @ApiOperation({ summary: '更新病历' })
  @Patch('phrases/:id')
  updatePhrase(@Param('id') id: string, @Body() dto: Partial<CreateRecordPhraseDto>, @Request() req: ExpressRequest) {
    return this.records.updatePhrase(id, dto, req.user?.id);
  }

  @ApiOperation({ summary: '删除病历' })
  @Delete('phrases/:id')
  deletePhrase(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.records.deletePhrase(id, req.user?.id);
  }

  @ApiOperation({ summary: '创建病历' })
  @Post('modify-requests')
  createModifyRequest(@Body() dto: CreateModifyRequestDto, @Request() req: ExpressRequest) {
    return this.records.createModifyRequest(dto, req.user?.id);
  }

  @ApiOperation({ summary: '查询病历列表' })
  @Get('modify-requests')
  listModifyRequests(@Query('status') status: string) {
    return this.records.listModifyRequests(status);
  }

  @ApiOperation({ summary: 'reviewModifyRequest - 病历' })
  @Post('modify-requests/:id/review')
  reviewModifyRequest(@Param('id') id: string, @Body() dto: ReviewModifyRequestDto, @Request() req: ExpressRequest) {
    return this.records.reviewModifyRequest(id, dto, req.user?.id);
  }

  // 动态 :id 路由必须放在所有静态路径（templates/phrases/modify-requests）之后，
  // 避免单段静态路径被 :id 参数捕获。

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.records.findOne(id);
  }

  @ApiOperation({ summary: '新增' })
  @Post()
  create(@Body() dto: CreateMedicalRecordDto) {
    return this.records.create(dto);
  }

  @ApiOperation({ summary: '更新' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMedicalRecordDto) {
    return this.records.update(id, dto);
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.records.remove(id);
  }

  @ApiOperation({ summary: 'lock - 病历' })
  @Post(':id/lock')
  lock(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.records.lock(id, req.user?.id);
  }
}
