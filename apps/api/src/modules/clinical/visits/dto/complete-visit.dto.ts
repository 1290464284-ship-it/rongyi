import { IsOptional, IsString } from 'class-validator';

export class CompleteVisitDto {
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  treatmentPlan?: string;
}
