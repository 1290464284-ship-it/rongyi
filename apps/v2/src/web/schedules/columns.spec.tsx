import { describe, expect, it } from 'vitest';
import { weekColumns } from './columns';

describe('week schedule columns', () => {
  it('falls back to raw ids, dash titles, and raw types', () => {
    const date = weekColumns.find((column) => column.key === 'date');
    const user = weekColumns.find((column) => column.key === 'userId');
    const title = weekColumns.find((column) => column.key === 'title');
    const type = weekColumns.find((column) => column.key === 'type');
    expect(date?.render?.({ date: '2026-08-03', weekDay: 3 } as never)).toContain('2026-08-03');
    expect(user?.render?.({ userId: 'u1' } as never)).toBe('u1');
    expect(title?.render?.({} as never)).toBe('—');
    expect(type?.render?.({ type: 'WEIRD' } as never)).toBe('WEIRD');
  });

  it('falls back to an empty weekday for out-of-range weekDays', () => {
    const date = weekColumns.find((column) => column.key === 'date');
    expect(date?.render?.({ date: '2026-08-03', weekDay: 7 } as never)).toBe('2026-08-03（）');
  });
});
