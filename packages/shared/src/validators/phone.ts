/**
 * 中国大陆手机号校验与格式化工具（前后端共享）
 *
 * 校验规则：11 位数字，1 开头，第二位 3-9
 * 正则：/^1[3-9]\d{9}$/
 */

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
