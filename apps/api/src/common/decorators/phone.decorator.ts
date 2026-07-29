import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { isPhoneNumber, normalizePhone } from '../utils/format/phone.utils';

@ValidatorConstraint({ async: false })
export class IsPhoneConstraint implements ValidatorConstraintInterface {
  validate(phone: string | null | undefined): boolean {
    if (phone === undefined || phone === null) return true;
    return isPhoneNumber(phone);
  }

  defaultMessage(): string {
    return '手机号格式不正确，请输入11位中国大陆手机号';
  }
}

/**
 * 手机号校验装饰器
 *
 * 校验规则：中国大陆 11 位手机号，1 开头，第二位 3-9
 *
 * 用法：
 *   @IsPhone()
 *   phone!: string;
 *
 * 配合 @IsOptional() 使用时，值为 undefined/null 时跳过校验：
 *   @IsOptional()
 *   @IsPhone()
 *   phone?: string;
 */
export function IsPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPhoneConstraint,
    });
  };
}

@ValidatorConstraint({ async: false })
export class IsPhoneNormalizedConstraint implements ValidatorConstraintInterface {
  validate(phone: string | null | undefined): boolean {
    if (phone === undefined || phone === null) return true;
    const normalized = normalizePhone(phone);
    return normalized ? isPhoneNumber(normalized) : false;
  }

  defaultMessage(): string {
    return '手机号格式不正确，请输入11位中国大陆手机号';
  }
}

/**
 * 宽松手机号校验装饰器（自动规范化）
 *
 * 会先自动去除空格、横线、+86 前缀等，再进行校验。
 * 适用于用户输入可能包含格式符的场景。
 *
 * 注意：此装饰器仅做校验，不会自动转换值。
 * 如需在 service 层使用规范化后的值，请调用 normalizePhone()。
 */
export function IsPhoneLoose(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPhoneNormalizedConstraint,
    });
  };
}
