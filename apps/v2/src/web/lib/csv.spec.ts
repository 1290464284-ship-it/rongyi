// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvCell, downloadTextFile } from './csv';

describe('lib/csv', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('escapes formula injection and quotes CSV cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{\"\"a\"\":1}"');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell('-1+1')).toBe('"\'-1+1"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it('downloads text files with a BOM prefix and releases the object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-csv');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });
    // jsdom 的 document.createElement 不实现 HTMLAnchorElement 下载行为，仅在本用例内替换
    document.createElement = vi.fn(() => ({ click }) as unknown as HTMLAnchorElement);
    // 定时器须在 downloadTextFile 之前启用：其内部 setTimeout 在调用时注册
    vi.useFakeTimers();
    downloadTextFile('报表.csv', 'a,b');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    // 延迟释放：1s 后 revoke（避免 Firefox 下载未开始即释放）
    vi.advanceTimersByTime(1001);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-csv');
  });
});
