import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { csvCell } from './csv';

/**
 * 测试侧独立实现的 CSV 单元格反向解析：整格为 "" 包裹、内部引号翻倍。
 * 与生产 csvCell 的转义规则互为逆操作，用于往返恒等断言。
 */
function unquoteCsvCell(cell: string): string {
  if (cell === '') return '';
  expect(cell.startsWith('"')).toBe(true);
  expect(cell.endsWith('"')).toBe(true);
  return cell.slice(1, -1).replaceAll('""', '"');
}

/** 与生产 String/JSON.stringify 分支一致的正则化文本。 */
function canonicalText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * 生产侧公式注入防护：文本以 = + - @ 制表符 回车 开头时前缀追加单引号。
 * 该前缀是刻意的安全改写，因此往返恒等断言在"加防护后文本"上成立。
 */
function guardedText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** 危险字符集中采样：逗号/引号/换行/制表符/回车/公式注入前缀/中文/emoji/纯数字等。 */
const trickyText = fc.string({
  maxLength: 30,
  unit: fc.constantFrom(',', '"', '\n', '\t', '\r', '=', '+', '-', '@', "'", '\\', '中', '文', '0', '9', 'a', 'Z', ' ', '🙂'),
});

/** 任意字段值：含引号包围串、逗号、换行、制表符、中文、空串、纯数字与对象。 */
const fieldValue = fc.oneof(
  trickyText,
  fc.string({ maxLength: 60 }),
  fc.string({ maxLength: 40, unit: 'binary' }),
  fc.integer(),
  fc.double({ min: -1e9, max: 1e9 }),
  fc.boolean(),
  fc.anything(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('"'),
  fc.constant(','),
  fc.constant('a"b,c\nd'),
  fc.constant('=SUM(A1)'),
  fc.record({ a: fc.string({ maxLength: 20 }), b: fc.integer() }),
  fc.array(fc.integer(), { maxLength: 8 }),
);

describe('csvCell 属性测试（CSV 转义）', () => {
  it('任意字段值转义后可按转义规则反向解析还原（往返恒等，含注入防护前缀）', () => {
    fc.assert(
      fc.property(fieldValue, (value) => {
        expect(unquoteCsvCell(csvCell(value))).toBe(guardedText(canonicalText(value)));
      }),
      { numRuns: 200 },
    );
  });

  it('输出整格被引号包裹，单元格内容中的逗号不越格（不破坏列结构）', () => {
    fc.assert(
      fc.property(fieldValue, fieldValue, (a, b) => {
        const cellA = csvCell(a);
        const cellB = csvCell(b);
        expect(cellA === '' || (cellA.startsWith('"') && cellA.endsWith('"'))).toBe(true);
        expect(cellB === '' || (cellB.startsWith('"') && cellB.endsWith('"'))).toBe(true);
        const line = `${cellA},${cellB}`;
        // 分隔符是第一个单元格之后的那个逗号：单元格内部逗号被引号包裹不会提前结束列
        expect(line.charAt(cellA.length)).toBe(',');
        expect(unquoteCsvCell(line.slice(0, cellA.length))).toBe(guardedText(canonicalText(a)));
        expect(unquoteCsvCell(line.slice(cellA.length + 1))).toBe(guardedText(canonicalText(b)));
      }),
      { numRuns: 100 },
    );
  });

  it('与手写样例一致（含公式注入防护与危险字符处理）', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('""');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb\tc')).toBe('"a\nb\tc"');
    expect(csvCell('中文')).toBe('"中文"');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
    expect(csvCell('-1')).toBe('"\'-1"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('\tlead')).toBe("\"'\tlead\"");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
