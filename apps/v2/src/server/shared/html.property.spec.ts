import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { escapeHtml } from './html';

/**
 * 测试侧独立的简单反转义：先还原 5 个字符实体，&amp; 最后处理，
 * 避免 '&amp;lt;' 被错误还原为 '<'。
 */
function unescapeHtml(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const HTML_ENTITIES = ['amp;', 'lt;', 'gt;', 'quot;', '#39;'];

/** 任意字符串：含 < > & " '、控制字符、中文、emoji 与超长串。 */
const anyText = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.string({ maxLength: 80, unit: 'binary' }),
  fc.string({
    maxLength: 120,
    unit: fc.constantFrom('&', '<', '>', '"', "'", '\n', '\t', '\r', '\x00', '中', '文', '🙂', 'a', ' '),
  }),
);

describe('escapeHtml 属性测试（HTML 转义）', () => {
  it('任意字符串转义后经反转义可还原原文（往返恒等）', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        expect(unescapeHtml(escapeHtml(text))).toBe(text);
      }),
      { numRuns: 200 },
    );
  });

  it('输出不含裸 < > 与裸 &（& 只出现在合法实体形态）', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const out = escapeHtml(text);
        expect(out).not.toContain('<');
        expect(out).not.toContain('>');
        for (const match of out.matchAll(/&/g)) {
          const rest = out.slice(match.index);
          expect(HTML_ENTITIES.some((entity) => rest.startsWith(`&${entity}`))).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('与手写样例一致', () => {
    expect(escapeHtml('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&#39;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    expect(escapeHtml('中文🙂')).toBe('中文🙂');
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml('a\r\nb\tc\x00d')).toBe('a\r\nb\tc\x00d');
  });
});
