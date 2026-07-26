import { IsString, MinLength, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

@ValidatorConstraint({ async: false })
class PasswordComplexity implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    if (!password) return false;
    if (password.length < 6) return false;
    if (password.length > 20) return false;
    if (!/[a-zA-Z]/.test(password)) return false;
    if (!/\d/.test(password)) return false;
    return true;
  }
  defaultMessage(_args: ValidationArguments): string {
    return '密码至少6位，必须包含字母和数字';
  }
}

export class ChangePasswordDto {
  @ApiProperty({ description: '原密码', example: 'oldPassword123' })
  @IsString()
  oldPassword!: string;

  @ApiProperty({ description: '新密码（6-20位，必须包含字母和数字）', example: 'newPassword456' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  @Validate(PasswordComplexity)
  newPassword!: string;
}
