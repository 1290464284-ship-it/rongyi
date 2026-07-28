/**
 * 手机号工具函数 — 基础校验/格式化统一从 @dental/shared 导出。
 *
 * P0 修复：消除与 packages/shared/src/validators/phone.ts 的重复实现。
 * 仅 validatePhoneNumber（抛异常版本）为 API 独有，保留在此。
 */

import { BusinessValidationException } from '../../errors';
import { isPhoneNumber } from '@dental/shared';

// re-export shared 中的基础函数供已有导入者使用
export { isPhoneNumber, normalizePhone } from '@dental/shared';

/**
 * 校验手机号并抛出异常（用于 service 层手动校验）。
 *
 * @param phone 待校验的手机号
 * @param fieldName 字段名，用于错误提示
 * @throws BusinessValidationException 手机号格式不正确时抛出
 */
export function validatePhoneNumber(phone: string, fieldName = '手机号'): void {
  if (!isPhoneNumber(phone)) {
    throw new BusinessValidationException(`${fieldName}格式不正确，请输入11位中国大陆手机号`);
  }
}
