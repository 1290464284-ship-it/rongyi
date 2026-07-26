/**
 * 统一的敏感信息脱敏工具函数。
 *
 * 用于业务场景下的脱敏展示（保留部分信息便于识别），区别于日志/操作日志中的
 * 全量 *** 替换（由 sensitive-fields.ts + isSensitiveField 提供）。
 *
 * 历史问题：各模块手动实现脱敏逻辑，实现方式不一致（正则 / slice / substring），
 * 位数处理不统一，容易遗漏。新增脱敏需求时统一在此处添加。
 */

/**
 * 身份证号脱敏：保留前 6 位和后 4 位，中间 8 位用 * 代替。
 *
 * 示例：110101199001011234 → 110101********1234
 *
 * 若输入长度不足 10 位，则原样返回（无法安全脱敏）。
 */
export function maskIdCard(idCard: string | null | undefined): string | null {
  if (!idCard) return null;
  if (idCard.length < 10) return idCard;
  return idCard.slice(0, 6) + '********' + idCard.slice(Math.max(0, idCard.length - 4));
}

/**
 * 手机号脱敏：保留前 3 位和后 4 位，中间 4 位用 * 代替。
 *
 * 示例：13800138000 → 138****8000
 *
 * 若输入长度不足 7 位，则原样返回。
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(Math.max(0, phone.length - 4));
}

/**
 * 邮箱脱敏：保留用户名前 2 位（不足 2 位则保留全部），域名完整保留，
 * 中间用 *** 连接。
 *
 * 示例：
 *   zhangsan@example.com → zh***@example.com
 *   a@example.com        → a***@example.com
 *
 * 若输入不含 @，则原样返回。
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return email;
  const username = email.slice(0, Math.max(0, atIndex));
  const domain = email.slice(Math.max(0, atIndex));
  const prefix = username.length >= 2 ? username.slice(0, 2) : username;
  return prefix + '***' + domain;
}

/**
 * 姓名脱敏：只保留第一个字符，其余用 * 代替。
 *
 * 示例：
 *   张三 → 张*
 *   欧阳修 → 欧**
 *   John → J***
 *
 * 若输入长度 ≤ 1，则原样返回。
 */
export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (name.length <= 1) return name;
  return name.charAt(0) + '*'.repeat(name.length - 1);
}
