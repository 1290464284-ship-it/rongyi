import { IsString, IsOptional, IsEnum, IsBoolean, MinLength, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { Role } from '../../../common/types/enums';

@ValidatorConstraint({ async: false })
class PasswordComplexity implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    if (!password) return false;
    if (/^\d{4}$/.test(password)) return true;
    if (password.length >= 6 && /[a-zA-Z]/.test(password) && /\d/.test(password)) return true;
    return false;
  }
  defaultMessage(args: ValidationArguments): string {
    return '密码必须是4位数字，或至少6位且包含字母和数字';
  }
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Validate(PasswordComplexity)
  password?: string;
}
