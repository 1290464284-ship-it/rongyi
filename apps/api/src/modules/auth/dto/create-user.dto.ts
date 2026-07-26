import { IsString, IsNotEmpty, IsEnum, IsOptional, MinLength, MaxLength, Validate, Matches } from 'class-validator';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@dental/shared';

@ValidatorConstraint({ async: false })
class PasswordComplexity implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    if (!password) return false;
    if (password.length < 6) return false;
    if (!/[a-zA-Z]/.test(password)) return false;
    if (!/\d/.test(password)) return false;
    return true;
  }
  defaultMessage(_args: ValidationArguments): string {
    return '密码至少6位，必须包含字母和数字';
  }
}

export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: 'doctor01' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: '密码（至少6位，包含字母和数字）', example: 'Abc123' })
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Validate(PasswordComplexity)
  password!: string;

  @ApiProperty({ description: '姓名', example: '张医生' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: '角色', enum: Role, example: Role.DOCTOR })
  @IsEnum(Role)
  role!: Role;

  @ApiProperty({ description: '手机号码', example: '13800138000', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' })
  phone?: string;
}
