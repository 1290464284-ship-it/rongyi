import { IsString, IsOptional, IsInt } from 'class-validator';

export class CreateRecordPhraseDto {
  @IsString() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsString() content!: string;
  @IsOptional() @IsInt() isPublic?: number;
}
