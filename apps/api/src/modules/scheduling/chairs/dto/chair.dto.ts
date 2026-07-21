import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateChairDto {
  @IsString() name: string;
  @IsOptional() @IsString() location?: string;
}

export class UpdateChairDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
