import { IsString, IsOptional, IsEnum, IsBoolean, MinLength, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@dental/shared';

@ValidatorConstraint({ async: false })
class PasswordComplexity implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    if (!password) return false;
    if (/^\d{4}$/.test(password)) return true;
    if (password.length >= 6 && /[a-zA-Z]/.test(password) && /\d/.test(password)) return true;
    return false;
  }
  defaultMessage(_args: ValidationArguments): string {
    return '密码必须是4位数字，或至少6位且包含字母和数字';
  }
}

export class UpdateUserDto {
  @ApiProperty({ description: '用户姓名', example: '李医生', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '用户角色', enum: Role, example: Role.DOCTOR, required: false })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiProperty({ description: '手机号码', example: '13800138000', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ description: '是否启用', example: true, required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ description: '新密码', example: 'REDACTED', required: false })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Validate(PasswordComplexity)
  password?: string;
}
