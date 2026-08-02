import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PrintService } from './print.service';
import { PrintTemplateService } from './print-template.service';
import {
  ClinicReportQueryDto,
  ListTemplatesQueryDto,
  PrintPreviewDto,
  SavePrintTemplateDto,
} from './dto/print-template.dto';

@ApiTags('打印服务')
@ApiBearerAuth('JWT-auth')
@UseGuards(RolesGuard)
@Controller('print')
export class PrintController {
  constructor(
    private printService: PrintService,
    private templateService: PrintTemplateService,
  ) {}

  @ApiOperation({ summary: '渲染处方单 HTML' })
  @Roles(Role.BOSS, Role.DOCTOR, Role.ADMIN, Role.RECEPTIONIST, Role.NURSE, Role.TECHNICIAN)
  @Post('prescription/:id')
  @HttpCode(200)
  async renderPrescription(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const html = await this.printService.renderPrescription(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }

  @ApiOperation({ summary: '渲染收费凭证 HTML' })
  @Roles(Role.BOSS, Role.DOCTOR, Role.ADMIN, Role.RECEPTIONIST, Role.NURSE, Role.TECHNICIAN)
  @Post('receipt/:id')
  @HttpCode(200)
  async renderReceipt(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const html = await this.printService.renderReceipt(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }

  @ApiOperation({ summary: '渲染治疗计划 HTML' })
  @Roles(Role.BOSS, Role.DOCTOR, Role.ADMIN, Role.RECEPTIONIST, Role.NURSE, Role.TECHNICIAN)
  @Post('treatment-plan/:id')
  @HttpCode(200)
  async renderTreatmentPlan(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const html = await this.printService.renderTreatmentPlan(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }

  @ApiOperation({ summary: '渲染诊所月度报告 HTML' })
  @Roles(Role.BOSS, Role.ADMIN)
  @Post('clinic-report')
  @HttpCode(200)
  async renderClinicReport(
    @Query() q: ClinicReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const html = await this.printService.renderClinicReport({ month: q.month });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }

  @ApiOperation({ summary: '渲染头影测量分析报告 HTML（CEPHALOMETRIC_REPORT 模板）' })
  @Roles(Role.BOSS, Role.DOCTOR, Role.ADMIN, Role.RECEPTIONIST, Role.NURSE, Role.TECHNICIAN)
  @Post('cephalometric-report/:id')
  @HttpCode(200)
  async renderCephalometricReport(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const html = await this.printService.renderCephalometricReport(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="cephalometric-report-${id}.html"`);
    return html;
  }

  @ApiOperation({ summary: '获取模板列表' })
  @Roles(Role.BOSS, Role.ADMIN, Role.DOCTOR)
  @Get('templates')
  listTemplates(@Query() q: ListTemplatesQueryDto) {
    return this.templateService.listTemplates({ category: q.category });
  }

  @ApiOperation({ summary: '获取单个模板详情' })
  @Roles(Role.BOSS, Role.ADMIN, Role.DOCTOR)
  @Get('templates/:code')
  getTemplate(@Param('code') code: string) {
    return this.templateService.getTemplate(code);
  }

  @ApiOperation({ summary: '保存/更新模板' })
  @Roles(Role.BOSS, Role.ADMIN)
  @Put('templates/:code')
  saveTemplate(@Param('code') code: string, @Body() dto: SavePrintTemplateDto) {
    return this.templateService.saveTemplate(code, {
      name: dto.name,
      content: dto.content,
      category: dto.category,
      variables: dto.variables,
      paperSize: dto.paperSize,
      orientation: dto.orientation,
    });
  }

  @ApiOperation({ summary: '将模板设为默认' })
  @Roles(Role.BOSS, Role.ADMIN)
  @Post('templates/:code/default')
  setDefault(@Param('code') code: string) {
    return this.templateService.setDefault(code);
  }

  @ApiOperation({ summary: '模板预览（使用示例或自定义上下文，不受 aiPrintEnabled 限制）' })
  @Roles(Role.BOSS, Role.ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @Post('templates/:code/preview')
  @HttpCode(200)
  previewTemplate(
    @Param('code') code: string,
    @Body() dto: PrintPreviewDto,
    @Res({ passthrough: true }) res: Response,
  ): string {
    const html = this.printService.renderPreview(code, dto.sampleContext);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }
}
