import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_\u{4e00}-\u{9fa5}]+$/u, { message: '用户名只能包含字母、数字、下划线和中文' })
  username!: string;

  @ApiProperty({ description: '密码', example: '123456' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password!: string;
}
