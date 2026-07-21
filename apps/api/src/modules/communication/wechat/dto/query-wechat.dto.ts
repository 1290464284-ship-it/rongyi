import { IsOptional, IsString } from 'class-validator';

export class QueryWechatDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
}
