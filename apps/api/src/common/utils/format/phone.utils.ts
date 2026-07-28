/**
 * 中国大陆手机号校验与格式化工具
 *
 * 校验规则：11 位数字，1 开头，第二位 3-9
 * 正则：/^1[3-9]\d{9}$/
 *
 * 历史问题：各模块手动实现手机号校验，正则不统一，有的只校验长度，
 * 有的允许 +86 前缀，有的第二位范围不对。新增手机号校验需求统一使用此处。
 */

import { BusinessValidationException } from '../../errors';

const PHONE_REGEX = /^1[3-9]\d{9}$/;

/**
 * 校验是否为合法的中国大陆手机号。
 *
 * 规则：11 位数字，1 开头，第二位 3-9
 *
 * @param phone 待校验的手机号
 * @returns true 表示合法，false 表示非法
 */
export function isPhoneNumber(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return PHONE_REGEX.test(phone);
}

/**
 * 校验手机号并抛出异常（用于 service 层手动校验）。
 *
 * @param phone 待校验的手机号
 * @param fieldName 字段名，用于错误提示
 * @throws BusinessValidationException 手机号格式不正确时抛出
 */
export function validatePhoneNumber(phone: string, fieldName = '手机号'): void {
  if (!isPhoneNumber(phone)) {
    // P3 修复：原先 throw new Error 会被全局过滤器当作未知错误返回 HTTP 500
    // 改为 BusinessValidationException 以返回 HTTP 400 + VALIDATION_ERROR
    throw new BusinessValidationException(`${fieldName}格式不正确，请输入11位中国大陆手机号`);
  }
}

/**
 * 规范化手机号：去除空格、横线等分隔符，移除 +86 前缀。
 *
 * 示例：
 *   +86 138-0013-8000 → 13800138000
 *   138 0013 8000     → 13800138000
 *
 * @param phone 原始手机号
 * @returns 规范化后的手机号（如果无法识别则返回原字符串）
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let normalized = phone.replace(/[\s-]/g, '');
  if (normalized.startsWith('+86')) {
    normalized = normalized.slice(3);
  } else if (normalized.startsWith('86') && normalized.length === 13) {
    normalized = normalized.slice(2);
  }
  return normalized;
}
