import { IsString, MinLength, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ async: false })
class PasswordComplexity implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    if (!password) return false;
    if (password.length < 6) return false;
    if (password.length > 20) return false;
    if (/^\d{6,}$/.test(password)) return true;
    if (/[a-zA-Z]/.test(password) && /\d/.test(password)) return true;
    return false;
  }
  defaultMessage(args: ValidationArguments): string {
    return '密码至少6位，支持纯数字或字母+数字组合';
  }
}

export class ChangePasswordDto {
  @IsString()
  oldPassword!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  @Validate(PasswordComplexity)
  newPassword!: string;
}
