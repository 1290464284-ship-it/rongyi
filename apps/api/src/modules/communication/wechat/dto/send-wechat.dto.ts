import { IsString, IsOptional, IsArray } from 'class-validator';

export class SendWechatDto {
  @IsOptional() @IsString() patientId?: string;
  @IsString() openId?: string;
  @IsString() content!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() remark?: string;
}

export class SendBatchWechatDto {
  @IsArray() @IsString({ each: true }) patientIds!: string[];
  @IsString() content!: string;
  @IsOptional() @IsString() type?: string;
}
