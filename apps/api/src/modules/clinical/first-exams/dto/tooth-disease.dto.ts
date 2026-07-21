import { IsString, IsInt, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class ToothDiseaseDto {
  @IsInt() toothNumber!: number;
  @IsOptional() @IsString() toothStatus?: string;
  @IsOptional() @IsArray() diseases?: string[];
  @IsOptional() @IsBoolean() isChief?: boolean;
  @IsOptional() @IsString() treatmentPlan?: string;
  @IsOptional() @IsString() remark?: string;
}
