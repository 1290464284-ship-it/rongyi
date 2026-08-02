import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Param,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { CephalometricService, ReportContext } from './cephalometric.service';
import {
  CreateCephalometricDto,
  UpdateCephalometricDto,
  ListCephalometricDto,
  CreateLandmarkSetDto,
  UpdateLandmarkSetDto,
  ListLandmarkSetsDto,
  AnalyzeQueryDto,
  AnalyzeBodyDto,
  ListAnalysesDto,
  CompareAnalysesDto,
  SaveNormValueDto,
} from './dto/cephalometric.dto';
import { TemplateName } from './template-comparison.service';
import { CephalometricAnalysisService } from './analysis.service';
import { NormValueService } from './norm-value.service';

@ApiTags('Orthodontics - Cephalometric')
@Controller('orthodontics/cephalometrics')
export class CephalometricController {
  constructor(private readonly cephalometricService: CephalometricService) {}

  @Post()
  @ApiOperation({ summary: '创建头影测量分析' })
  async create(@Body() dto: CreateCephalometricDto) {
    return this.cephalometricService.createAnalysis(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新头影测量分析' })
  async update(@Param('id') id: string, @Body() dto: UpdateCephalometricDto) {
    return this.cephalometricService.updateAnalysis(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除头影测量分析（软删除）' })
  async remove(@Param('id') id: string) {
    await this.cephalometricService.deleteAnalysis(id);
    return { success: true, id };
  }

  @Get()
  @ApiOperation({ summary: '查询头影测量分析列表' })
  async list(@Query() query: ListCephalometricDto) {
    return this.cephalometricService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个头影测量分析详情' })
  async getOne(@Param('id') id: string) {
    return this.cephalometricService.getById(id);
  }

  @Post(':id/recalc')
  @ApiOperation({ summary: '重新计算 measurements/classification/planes' })
  async recalc(@Param('id') id: string) {
    return this.cephalometricService.recalc(id);
  }

  @Post(':id/validate')
  @ApiOperation({ summary: '医生确认标注点（landmarksValidated=1）' })
  async validate(@Param('id') id: string) {
    return this.cephalometricService.validate(id);
  }

  @Post(':id/compare/:template')
  @ApiOperation({ summary: '对比指定模板并保存结果' })
  async compare(@Param('id') id: string, @Param('template') template: TemplateName) {
    return this.cephalometricService.compare(id, template);
  }

  @Get(':id/report-context')
  @ApiOperation({ summary: '获取报告渲染上下文（供 T16 打印引擎使用）' })
  async reportContext(@Param('id') id: string): Promise<ReportContext> {
    return this.cephalometricService.generateReport(id);
  }

  @Post(':id/print')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '渲染打印 HTML（CEPHALOMETRIC_REPORT 模板）' })
  @ApiResponse({ content: { 'text/html': { schema: { type: 'string' } } } })
  async print(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    const html = await this.cephalometricService.renderPrintHtml(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="cephalometric-${id}.html"`);
    return html;
  }
}

/**
 * Task 19 新流程控制器（landmark-sets / analyses / norm-values）
 * 基于短代码标志点 + 多方法指标公式 + 正常值对比
 */
@ApiTags('Orthodontics - Cephalometric Analysis')
@Controller('cephalometric')
export class CephalometricAnalysisController {
  constructor(
    private readonly analysisService: CephalometricAnalysisService,
    private readonly normValueService: NormValueService,
  ) {}

  // ============= 标志点集合 =============

  @Post('landmark-sets')
  @ApiOperation({ summary: '创建标志点集合' })
  async createLandmarkSet(@Body() dto: CreateLandmarkSetDto) {
    return this.analysisService.createLandmarkSet({
      patientId: dto.patientId,
      imagingId: dto.imagingId,
      name: dto.name ?? '初始',
      landmarks: dto.landmarks,
      analysisMethod: dto.analysisMethod,
    });
  }

  @Get('landmark-sets')
  @ApiOperation({ summary: '查询标志点集合列表（可按 patientId 过滤）' })
  async listLandmarkSets(@Query() q: ListLandmarkSetsDto) {
    return this.analysisService.listLandmarkSets(q.patientId);
  }

  @Get('landmark-sets/:id')
  @ApiOperation({ summary: '获取标志点集合详情' })
  async getLandmarkSet(@Param('id') id: string) {
    return this.analysisService.getLandmarkSetById(id);
  }

  @Patch('landmark-sets/:id')
  @ApiOperation({ summary: '更新标志点集合' })
  async updateLandmarkSet(@Param('id') id: string, @Body() dto: UpdateLandmarkSetDto) {
    return this.analysisService.updateLandmarkSet(id, {
      name: dto.name,
      landmarks: dto.landmarks,
      analysisMethod: dto.analysisMethod,
      imagingId: dto.imagingId,
    });
  }

  @Post('landmark-sets/:id/analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '执行头影测量分析（method query 或 body）' })
  async analyze(
    @Param('id') id: string,
    @Query() q: AnalyzeQueryDto,
    @Body() body?: AnalyzeBodyDto,
  ) {
    return this.analysisService.saveAnalysis(id, {
      method: body?.method ?? q.method,
      note: body?.note,
      doctorId: body?.doctorId,
    });
  }

  // ============= 分析记录 =============

  @Get('analyses/:id')
  @ApiOperation({ summary: '获取分析记录详情' })
  async getAnalysis(@Param('id') id: string) {
    return this.analysisService.getAnalysisById(id);
  }

  @Get('analyses')
  @ApiOperation({ summary: '查询分析记录列表（按 patientId 过滤）' })
  async listAnalyses(@Query() q: ListAnalysesDto) {
    return this.analysisService.listByPatient(q.patientId ?? '');
  }

  @Post('analyses/compare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '两条分析记录对比 diff' })
  async compareAnalyses(@Body() dto: CompareAnalysesDto) {
    return this.analysisService.compareRecords(dto.id1, dto.id2);
  }

  @Delete('analyses/:id')
  @ApiOperation({ summary: '删除分析记录（软删除）' })
  async deleteAnalysis(@Param('id') id: string) {
    await this.analysisService.deleteById(id);
    return { success: true, id };
  }

  // ============= 正常值 =============

  @Get('norm-values')
  @ApiOperation({ summary: '查询正常值列表（硬编码默认 + 诊所自定义）' })
  async listNormValues() {
    return {
      defaults: this.normValueService.listHardcodedNorms(),
      overrides: this.normValueService.listDbOverrides(),
    };
  }

  @Post('norm-values')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增/覆写自定义正常值' })
  async saveNormValue(@Body() dto: SaveNormValueDto) {
    return this.normValueService.saveOverride({
      code: dto.code,
      label: dto.label ?? dto.code,
      method: dto.method,
      adultChild: dto.adultChild ?? 'ADULT',
      gender: dto.gender ?? 'ALL',
      min: dto.min,
      max: dto.max,
      unit: dto.unit ?? '°',
      source: dto.source ?? 'DB 自定义',
    });
  }

  @Get('landmarks')
  @ApiOperation({ summary: '获取 30 个标准标志点常量（供前端渲染 UI）' })
  async listLandmarks() {
    return this.analysisService.listShortCodeLandmarks();
  }
}
