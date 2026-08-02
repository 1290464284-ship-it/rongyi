 
import { IsString, IsOptional, IsObject, IsEnum, IsNotEmpty, MaxLength, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Landmarks, ShortCodeLandmarks } from '../cephalometric-landmarks';
import { ReferencePlanes } from '../reference-planes';
import { AnalysisMethod } from '../metrics-formula.service';

export class CreateCephalometricDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  patientId!: string;

  @ApiPropertyOptional({ description: '关联影像 Imaging ID', example: 'imaging-uuid-001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  imagingId?: string;

  @ApiPropertyOptional({ description: '医生ID', example: 'doctor-uuid-001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  doctorId?: string;

  @ApiProperty({ description: '头影测量名称', example: '初诊头影' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: '标注点坐标 JSON',
    example: '{"Nasion":{"x":200,"y":100},"Sella":{"x":100,"y":100}}',
  })
  @IsObject()
  landmarks!: Landmarks;

  @ApiPropertyOptional({
    description: '参考平面（不传则自动计算）',
    example: '{"SN":{"A":{"x":100,"y":100},"B":{"x":200,"y":100}}}',
  })
  @IsOptional()
  @IsObject()
  referencePlanes?: ReferencePlanes;

  @ApiPropertyOptional({
    description: '是否跳过自动计算测量指标（true=使用传入数据，默认false自动重算）',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  skipRecalc?: boolean;

  @ApiPropertyOptional({ description: '备注说明', example: '患者合作良好' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCephalometricDto {
  @ApiPropertyOptional({ description: '名称', example: '治疗中头影' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: '影像ID', example: 'imaging-uuid-002' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  imagingId?: string;

  @ApiPropertyOptional({ description: '医生ID', example: 'doctor-uuid-002' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  doctorId?: string;

  @ApiPropertyOptional({ description: '标注点坐标 JSON' })
  @IsOptional()
  @IsObject()
  landmarks?: Landmarks;

  @ApiPropertyOptional({ description: '参考平面' })
  @IsOptional()
  @IsObject()
  referencePlanes?: ReferencePlanes;

  @ApiPropertyOptional({ description: '备注说明', example: '治疗3个月后对比' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: '是否跳过自动重算（默认false）', example: false })
  @IsOptional()
  @IsBoolean()
  skipRecalc?: boolean;
}

export class ListCephalometricDto {
  @ApiPropertyOptional({ description: '按患者ID过滤', example: 'patient-uuid-001' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ description: '页码，默认1', example: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: '每页条数，默认20', example: 20 })
  @IsOptional()
  pageSize?: number;

  @ApiPropertyOptional({ description: '游标分页：上一页最后一条id', example: '' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: '关键词搜索', example: '初诊' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class CompareTemplateDto {
  @ApiProperty({
    description: '对比模板名称',
    enum: ['ANDREWS', 'BOLTON', 'TWEED', 'CHINESE_NORMAL'],
    example: 'CHINESE_NORMAL',
  })
  @IsEnum(['ANDREWS', 'BOLTON', 'TWEED', 'CHINESE_NORMAL'])
  templateName!: 'ANDREWS' | 'BOLTON' | 'TWEED' | 'CHINESE_NORMAL';
}

// =========================================================================
// Task 19 新流程 DTO（landmark-sets / analyses / norm-values）
// =========================================================================

export class CreateLandmarkSetDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  patientId!: string;

  @ApiPropertyOptional({ description: '关联影像 Imaging ID', example: 'imaging-uuid-001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  imagingId?: string;

  @ApiPropertyOptional({ description: '标志点集合名称', example: '术前' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    description: '标志点坐标 JSON（短代码 → {x,y}）',
    example: '{"S":{"x":100,"y":100},"N":{"x":200,"y":100}}',
  })
  @IsObject()
  landmarks!: ShortCodeLandmarks;

  @ApiPropertyOptional({
    description: '分析方法',
    enum: ['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'],
    example: 'STEINER',
  })
  @IsOptional()
  @IsEnum(['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'])
  analysisMethod?: AnalysisMethod;
}

export class UpdateLandmarkSetDto {
  @ApiPropertyOptional({ description: '标志点集合名称', example: '术后' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: '标志点坐标 JSON' })
  @IsOptional()
  @IsObject()
  landmarks?: ShortCodeLandmarks;

  @ApiPropertyOptional({ description: '分析方法', enum: ['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'] })
  @IsOptional()
  @IsEnum(['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'])
  analysisMethod?: AnalysisMethod;

  @ApiPropertyOptional({ description: '关联影像ID' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  imagingId?: string;
}

export class ListLandmarkSetsDto {
  @ApiPropertyOptional({ description: '按患者ID过滤', example: 'patient-uuid-001' })
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class AnalyzeQueryDto {
  @ApiPropertyOptional({ description: '分析方法（不传则使用标志点集合默认方法）', enum: ['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'] })
  @IsOptional()
  @IsEnum(['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'])
  method?: AnalysisMethod;
}

export class AnalyzeBodyDto {
  @ApiPropertyOptional({ description: '分析方法', enum: ['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'] })
  @IsOptional()
  @IsEnum(['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'])
  method?: AnalysisMethod;

  @ApiPropertyOptional({ description: '备注', example: '术前评估' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: '医生ID', example: 'doctor-uuid-001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  doctorId?: string;
}

export class ListAnalysesDto {
  @ApiPropertyOptional({ description: '按患者ID过滤', example: 'patient-uuid-001' })
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class CompareAnalysesDto {
  @ApiProperty({ description: '第一条分析记录ID' })
  @IsString()
  @IsNotEmpty()
  id1!: string;

  @ApiProperty({ description: '第二条分析记录ID' })
  @IsString()
  @IsNotEmpty()
  id2!: string;
}

export class SaveNormValueDto {
  @ApiProperty({ description: '指标代码', example: 'SNA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ description: '指标标签', example: 'SNA 角' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiProperty({ description: '分析方法', enum: ['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'] })
  @IsEnum(['STEINER', 'DOWNS', 'TWEE', 'MCNAMARA'])
  method!: AnalysisMethod;

  @ApiPropertyOptional({ description: '成人/儿童', enum: ['ADULT', 'CHILD'], example: 'ADULT' })
  @IsOptional()
  @IsEnum(['ADULT', 'CHILD'])
  adultChild?: 'ADULT' | 'CHILD';

  @ApiPropertyOptional({ description: '性别', enum: ['M', 'F', 'ALL'], example: 'ALL' })
  @IsOptional()
  @IsEnum(['M', 'F', 'ALL'])
  gender?: 'M' | 'F' | 'ALL';

  @ApiProperty({ description: '正常值下界', example: 79 })
  @IsNumber()
  @Min(0)
  @Max(360)
  min!: number;

  @ApiProperty({ description: '正常值上界', example: 85 })
  @IsNumber()
  @Min(0)
  @Max(360)
  max!: number;

  @ApiPropertyOptional({ description: '单位', example: '°' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ description: '来源', example: '教材《口腔正畸学》第7版' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
}
