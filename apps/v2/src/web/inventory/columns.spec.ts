import { describe, expect, it } from 'vitest';
import { detailReportColumns, summaryReportColumns } from './columns';

describe('inventory report columns', () => {
  it('falls back to item ids and empty strings for missing names', () => {
    const detail = detailReportColumns.find((column) => column.key === 'itemName');
    expect(detail?.render?.({ itemId: 'item-1' } as never)).toBe('item-1');
    expect(detail?.render?.({} as never)).toBe('');

    const summary = summaryReportColumns.find((column) => column.key === 'name');
    expect(summary?.render?.({ itemId: 'item-2' } as never)).toBe('item-2');
    expect(summary?.render?.({} as never)).toBe('');
  });
});
