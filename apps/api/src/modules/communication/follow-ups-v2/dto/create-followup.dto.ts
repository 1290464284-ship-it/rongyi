import { IsString, IsOptional, IsDateString, IsInt, Min, Max } from 'class-validator';

export class CreateFollowupDto {
  @IsString()
  patientId!: string;

  @IsDateString()
  planDate!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;
}
