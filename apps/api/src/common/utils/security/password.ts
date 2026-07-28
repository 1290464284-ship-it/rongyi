/**
 * 密码安全工具函数
 *
 * 提供密码复杂度校验，用于初始管理员密码、Swagger 密码等场景。
 */

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_SEQUENCES = [
  '0123456789',
  '9876543210',
  'abcdefghijklmnopqrstuvwxyz',
  'zyxwvutsrqponmlkjihgfedcba',
];

const COMMON_WEAK_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  'password',
  'password123',
  'admin',
  'admin123',
  'qwerty',
  'abc123',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'master',
  'login',
  'princess',
  'sunshine',
  '111111',
  '000000',
]);

function isSequential(value: string): boolean {
  if (value.length < 4) return false;
  const lower = value.toLowerCase();

  // 检查密码中任意长度为 4 的子串是否属于常见连续序列
  for (let i = 0; i <= lower.length - 4; i++) {
    const chunk = lower.substring(i, i + 4);
    for (const seq of COMMON_SEQUENCES) {
      if (seq.includes(chunk)) return true;
    }
  }
  return false;
}

function isAllSameChar(value: string): boolean {
  if (value.length === 0) return true;
  const first = value[0];
  for (let i = 1; i < value.length; i++) {
    if (value[i] !== first) return false;
  }
  return true;
}

/**
 * 校验密码复杂度。
 *
 * 规则：
 * - 长度 8-128 位
 * - 不能是常见弱密码
 * - 不能全部由相同字符组成
 * - 不能包含连续 4 位以上的顺序字符（如 1234、abcd）
 * - 必须同时包含字母和数字
 */
export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (typeof password !== 'string') {
    return { valid: false, errors: ['密码必须是字符串'] };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`);
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    errors.push('密码过于常见，请更换为更复杂的密码');
  }
  if (isAllSameChar(password)) {
    errors.push('密码不能全部由相同字符组成');
  }
  if (isSequential(password)) {
    errors.push('密码不能包含连续顺序字符（如 1234、abcd）');
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasLetter || !hasDigit) {
    errors.push('密码必须同时包含字母和数字');
  }

  return { valid: errors.length === 0, errors };
}
