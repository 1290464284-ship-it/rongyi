import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { FollowUpsV2Service } from './follow-ups-v2.service';
import { CreateFollowupDto } from './dto/create-followup.dto';
import { UpdateFollowupDto } from './dto/update-followup.dto';
import { QueryFollowupDto } from './dto/query-followup.dto';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  CreateItemDto,
  UpdateItemDto,
  CreateResultDto,
  UpdateResultDto,
} from './dto/template.dto';
import { CreateAutoRuleDto, UpdateAutoRuleDto } from './dto/auto-rule.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('随访管理')
@Controller('follow-ups-v2')
export class FollowUpsV2Controller {
  constructor(private followUpsV2Service: FollowUpsV2Service) {}

  @Get()
  findAll() {
    return this.followUpsV2Service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.followUpsV2Service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFollowupDto) {
    return this.followUpsV2Service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFollowupDto) {
    return this.followUpsV2Service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.followUpsV2Service.remove(id);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: UpdateFollowupDto) {
    return this.followUpsV2Service.complete(id, dto.result);
  }

  @Get('templates/list')
  listTemplates() {
    return this.followUpsV2Service.listTemplates();
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.followUpsV2Service.createTemplate(dto);
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.followUpsV2Service.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string) {
    return this.followUpsV2Service.deleteTemplate(id);
  }

  @Post('templates/:id/toggle')
  toggleTemplate(@Param('id') id: string) {
    return this.followUpsV2Service.toggleTemplate(id);
  }

  @Get('items/list')
  listItems(@Query('templateId') templateId?: string) {
    return this.followUpsV2Service.listItems(templateId || '');
  }

  @Post('items')
  createItem(@Body() dto: CreateItemDto) {
    return this.followUpsV2Service.createItem(dto);
  }

  @Patch('items/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.followUpsV2Service.updateItem(id, dto);
  }

  @Delete('items/:id')
  deleteItem(@Param('id') id: string) {
    return this.followUpsV2Service.deleteItem(id);
  }

  @Get('results/list')
  listResults() {
    return this.followUpsV2Service.listResults();
  }

  @Post('results')
  createResult(@Body() dto: CreateResultDto) {
    return this.followUpsV2Service.createResult(dto);
  }

  @Patch('results/:id')
  updateResult(@Param('id') id: string, @Body() dto: UpdateResultDto) {
    return this.followUpsV2Service.updateResult(id, dto);
  }

  @Delete('results/:id')
  deleteResult(@Param('id') id: string) {
    return this.followUpsV2Service.deleteResult(id);
  }

  @Get('auto-rules/list')
  listAutoRules() {
    return this.followUpsV2Service.listAutoRules();
  }

  @Post('auto-rules')
  createAutoRule(@Body() dto: CreateAutoRuleDto) {
    return this.followUpsV2Service.createAutoRule(dto);
  }

  @Patch('auto-rules/:id')
  updateAutoRule(@Param('id') id: string, @Body() dto: UpdateAutoRuleDto) {
    return this.followUpsV2Service.updateAutoRule(id, dto);
  }

  @Delete('auto-rules/:id')
  deleteAutoRule(@Param('id') id: string) {
    return this.followUpsV2Service.deleteAutoRule(id);
  }

  @Post('auto-rules/:id/toggle')
  toggleAutoRule(@Param('id') id: string) {
    return this.followUpsV2Service.toggleAutoRule(id);
  }

  @Get('stats/workload')
  workloadStats() {
    return this.followUpsV2Service.workloadStats();
  }

  @Get('stats/nps')
  npsStats() {
    return this.followUpsV2Service.npsStats();
  }
}
