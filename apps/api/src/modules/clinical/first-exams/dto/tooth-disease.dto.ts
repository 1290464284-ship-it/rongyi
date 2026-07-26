import { IsString, IsInt, IsOptional, IsArray, IsBoolean, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToothDiseaseDto {
  @ApiProperty({ description: '牙位号（FDI标记法，11-85）', example: 16 })
  @IsInt() @Min(11) @Max(85) toothNumber!: number;

  @ApiProperty({ description: '牙齿状态', example: '龋坏', required: false })
  @IsOptional() @IsString() @MaxLength(50) toothStatus?: string;

  @ApiProperty({ description: '疾病诊断列表', type: 'array', items: { type: 'string' }, example: ['深龋', '牙髓炎'], required: false })
  @IsOptional() @IsArray() diseases?: string[];

  @ApiProperty({ description: '是否为主诉牙', example: false, required: false })
  @IsOptional() @IsBoolean() isChief?: boolean;

  @ApiProperty({ description: '治疗计划', example: '根管治疗后全冠修复', required: false })
  @IsOptional() @IsString() @MaxLength(2000) treatmentPlan?: string;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional() @IsString() @MaxLength(1000) remark?: string;
}
