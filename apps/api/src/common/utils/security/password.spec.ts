import { validatePasswordComplexity } from './password';

describe('validatePasswordComplexity', () => {
  it('应接受满足复杂度要求的密码', () => {
    const result = validatePasswordComplexity('StrongP@ssw0rd');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('应拒绝长度不足的密码', () => {
    const result = validatePasswordComplexity('A1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码长度不能少于 8 位');
  });

  it('应拒绝过长的密码', () => {
    const result = validatePasswordComplexity('A1'.repeat(65));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码长度不能超过 128 位');
  });

  it('应拒绝常见弱密码', () => {
    const result = validatePasswordComplexity('password123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码过于常见，请更换为更复杂的密码');
  });

  it('应拒绝全部由相同字符组成的密码', () => {
    const result = validatePasswordComplexity('aaaaaaaa');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码不能全部由相同字符组成');
  });

  it('应拒绝连续顺序数字的密码', () => {
    const result = validatePasswordComplexity('abcd1234');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码不能包含连续顺序字符（如 1234、abcd）');
  });

  it('应拒绝连续顺序字母的密码', () => {
    const result = validatePasswordComplexity('abcdefgh1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码不能包含连续顺序字符（如 1234、abcd）');
  });

  it('应拒绝只有字母的密码', () => {
    const result = validatePasswordComplexity('Password');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码必须同时包含字母和数字');
  });

  it('应拒绝只有数字的密码', () => {
    const result = validatePasswordComplexity('123456789');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码必须同时包含字母和数字');
  });

  it('非字符串输入应返回错误', () => {
    const result = validatePasswordComplexity(12345678 as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('密码必须是字符串');
  });
});
