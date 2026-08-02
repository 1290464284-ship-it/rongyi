import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class ListSurveysDto extends PaginationQueryDto {
  @ApiProperty({ description: '按就诊ID筛选', required: false })
  @IsOptional()
  @IsString()
  visitId?: string;

  @ApiProperty({ description: '按患者ID筛选', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '按医生ID筛选', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '开始日期 (ISO YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ description: '结束日期 (ISO YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  to?: string;
}
