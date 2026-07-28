import { describe, it, expect } from 'vitest';
import { sanitizeRichText, sanitizePlainText, escapeHtml, validateInput } from '@/lib/utils/security';

describe('security 工具', () => {
  describe('sanitizeRichText', () => {
    it('保留白名单富文本标签', () => {
      expect(sanitizeRichText('<p>你好<strong>世界</strong></p>')).toBe('<p>你好<strong>世界</strong></p>');
    });

    it('丢弃 script 等危险标签', () => {
      expect(sanitizeRichText('<p>安全</p><script>alert(1)</script>')).toBe('<p>安全</p>');
    });

    it('剥离所有属性（如 onclick）', () => {
      expect(sanitizeRichText('<p onclick="alert(1)">文本</p>')).toBe('<p>文本</p>');
    });

    it('空字符串返回空', () => {
      expect(sanitizeRichText('')).toBe('');
    });
  });

  describe('sanitizePlainText', () => {
    it('移除所有 HTML 标签只留文本', () => {
      expect(sanitizePlainText('<b>加粗</b>与<i>斜体</i>')).toBe('加粗与斜体');
    });

    it('空字符串返回空', () => {
      expect(sanitizePlainText('')).toBe('');
    });
  });

  describe('escapeHtml', () => {
    it('转义 HTML 特殊字符', () => {
      expect(escapeHtml('<div>&"</div>')).toBe('&lt;div&gt;&amp;"&lt;/div&gt;');
    });

    it('空字符串返回空', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('validateInput', () => {
    it('空值视为合法', () => {
      expect(validateInput('')).toBe(true);
    });

    it('未指定长度限制时任意文本合法', () => {
      expect(validateInput('任意长度的文本')).toBe(true);
    });

    it('超过 maxLength 时不合法', () => {
      expect(validateInput('12345', 4)).toBe(false);
    });

    it('等于 maxLength 时合法', () => {
      expect(validateInput('1234', 4)).toBe(true);
    });
  });
});
