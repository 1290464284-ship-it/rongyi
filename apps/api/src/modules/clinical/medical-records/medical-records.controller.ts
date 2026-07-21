import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { MedicalRecordsService } from './medical-records.service';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';
import { UpdateMedicalRecordDto } from './dto/update-medical-record.dto';
import { QueryMedicalRecordDto } from './dto/query-medical-record.dto';
import { CreateRecordTemplateDto } from './dto/create-record-template.dto';
import { CreateRecordPhraseDto } from './dto/create-record-phrase.dto';
import { CreateModifyRequestDto, ReviewModifyRequestDto } from './dto/modify-request.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR)
@ApiTags('病历管理')
@Controller('medical-records')
export class MedicalRecordsController {
  constructor(private records: MedicalRecordsService) {}

  @Get()
  findAll(@Query() q: QueryMedicalRecordDto, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.records.findMany({ ...q, page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.records.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateMedicalRecordDto) {
    return this.records.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMedicalRecordDto) {
    return this.records.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.records.remove(id);
  }

  @Post(':id/lock')
  lock(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.records.lock(id, req.user?.id);
  }

  @Get('templates')
  listTemplates(@Query('category') category: string, @Request() req: ExpressRequest) {
    return this.records.listTemplates(req.user?.id, category);
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateRecordTemplateDto, @Request() req: ExpressRequest) {
    return this.records.createTemplate(dto, req.user?.id);
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: Partial<CreateRecordTemplateDto>, @Request() req: ExpressRequest) {
    return this.records.updateTemplate(id, dto, req.user?.id);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.records.deleteTemplate(id, req.user?.id);
  }

  @Get('phrases')
  listPhrases(@Query('category') category: string, @Request() req: ExpressRequest) {
    return this.records.listPhrases(req.user?.id, category);
  }

  @Post('phrases')
  createPhrase(@Body() dto: CreateRecordPhraseDto, @Request() req: ExpressRequest) {
    return this.records.createPhrase(dto, req.user?.id);
  }

  @Patch('phrases/:id')
  updatePhrase(@Param('id') id: string, @Body() dto: Partial<CreateRecordPhraseDto>, @Request() req: ExpressRequest) {
    return this.records.updatePhrase(id, dto, req.user?.id);
  }

  @Delete('phrases/:id')
  deletePhrase(@Param('id') id: string, @Request() req: ExpressRequest) {
    return this.records.deletePhrase(id, req.user?.id);
  }

  @Post('modify-requests')
  createModifyRequest(@Body() dto: CreateModifyRequestDto, @Request() req: ExpressRequest) {
    return this.records.createModifyRequest(dto, req.user?.id);
  }

  @Get('modify-requests')
  listModifyRequests(@Query('status') status: string) {
    return this.records.listModifyRequests(status);
  }

  @Post('modify-requests/:id/review')
  reviewModifyRequest(@Param('id') id: string, @Body() dto: ReviewModifyRequestDto, @Request() req: ExpressRequest) {
    return this.records.reviewModifyRequest(id, dto, req.user?.id);
  }
}
