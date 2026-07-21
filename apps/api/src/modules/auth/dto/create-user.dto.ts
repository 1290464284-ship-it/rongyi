import { IsString, IsNotEmpty, IsEnum, IsOptional, MinLength, MaxLength, Matches, Validate } from 'class-validator';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { Role } from '../../../common/types/enums';

@ValidatorConstraint({ async: false })
class PasswordComplexity implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    if (!password) return false;
    // 允许4位数字 PIN（向后兼容）
    if (/^\d{4}$/.test(password)) return true;
    // 或者至少6位，包含字母和数字
    if (password.length >= 6 && /[a-zA-Z]/.test(password) && /\d/.test(password)) return true;
    return false;
  }
  defaultMessage(args: ValidationArguments): string {
    return '密码必须是4位数字，或至少6位且包含字母和数字';
  }
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Validate(PasswordComplexity)
  password!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  phone?: string;
}
