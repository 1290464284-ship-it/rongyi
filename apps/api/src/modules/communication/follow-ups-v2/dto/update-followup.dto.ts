import { IsString, IsOptional, IsDateString, IsInt, Min, Max } from 'class-validator';

export class UpdateFollowupDto {
  @IsOptional()
  @IsDateString()
  planDate?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  resultId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  patientSatisfaction?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  npsScore?: number;
}
