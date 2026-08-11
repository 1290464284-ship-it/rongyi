import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function collectFiles(dir: string, output: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collectFiles(full, output);
    else if (name.endsWith('.tsx') && !name.endsWith('.spec.tsx')) output.push(full);
  }
  return output;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('web button accessibility static scan', () => {
  it('does not contain icon-only buttons without an accessible name', () => {
    const root = path.resolve(import.meta.dirname);
    const issues: string[] = [];

    for (const file of collectFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      const buttonPattern = /<button\b[^>]*>/g;
      let match: RegExpExecArray | null;
      while ((match = buttonPattern.exec(text)) !== null) {
        const openTag = match[0];
        if (/\b(aria-label|aria-labelledby|title)=/.test(openTag)) continue;
        if (/\s\/>$/.test(openTag.trimEnd())) {
          issues.push(`${path.relative(root, file)}:${lineAt(text, match.index)} self-closing button without aria-label/title`);
          continue;
        }
        const close = text.indexOf('</button>', buttonPattern.lastIndex);
        if (close === -1) continue;
        const inner = text.slice(buttonPattern.lastIndex, close);
        const visibleText = inner
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, '');
        if (!visibleText) {
          issues.push(`${path.relative(root, file)}:${lineAt(text, match.index)} icon-only button without aria-label/title`);
        }
      }
    }

    expect(issues).toEqual([]);
  });
});
