import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from './redact';

describe('redactSensitiveText', () => {
  it('masks phone numbers and id card numbers', () => {
    expect(redactSensitiveText('患者电话 13912345678 已回访')).toBe('患者电话 139****5678 已回访');
    expect(redactSensitiveText('身份证 11010119900101123X 校验')).toBe('身份证 1101**********123X 校验');
  });

  it('masks multiple occurrences', () => {
    const input = 'a:13800138000 b:15900159000';
    expect(redactSensitiveText(input)).toBe('a:138****8000 b:159****9000');
  });

  it('keeps non-PII text intact', () => {
    const text = '订单号 2026081300012345，金额 1234.56，诊断 ok';
    expect(redactSensitiveText(text)).toBe(text);
  });

  it('does not mask shorter numeric sequences', () => {
    expect(redactSensitiveText('编号 12345678')).toBe('编号 12345678');
  });
});
