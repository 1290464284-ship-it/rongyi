import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml('<script>alert("&")</script>\'')).toBe(
      '&lt;script&gt;alert(&quot;&amp;&quot;)&lt;/script&gt;&#39;',
    );
  });

  it('keeps safe text unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});
