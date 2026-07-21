import { IsString, IsOptional } from 'class-validator';

export class CreateModifyRequestDto {
  @IsString() recordId!: string;
  @IsString() reason!: string;
}

export class ReviewModifyRequestDto {
  @IsString() status!: string;
  @IsOptional() @IsString() reviewRemark?: string;
}
