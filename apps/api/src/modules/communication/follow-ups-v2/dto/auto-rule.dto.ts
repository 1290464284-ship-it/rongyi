import { IsString, IsOptional, IsInt, Min, IsBoolean } from 'class-validator';

export class CreateAutoRuleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  triggerType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  triggerDays?: number;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class UpdateAutoRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  triggerType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  triggerDays?: number;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
