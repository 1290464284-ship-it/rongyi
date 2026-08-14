// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataTable } from './data-table';

describe('DataTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('windows large row sets and reveals more on scroll', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ id: `r-${index}`, name: `Row ${index}` }));
    render(<DataTable columns={[{ key: 'name', label: '名称' }]} rows={rows} keyField="id" />);
    expect(screen.queryByText('Row 99')).not.toBeNull();
    expect(screen.queryByText('Row 100')).toBeNull();

    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 10000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 9500, configurable: true });
    for (let index = 0; index < 5; index += 1) fireEvent.scroll(container);
    expect(screen.queryByText('Row 100')).not.toBeNull();
    expect(screen.queryByText('Row 149')).not.toBeNull();
  });

  it('keeps the 500-row cap and its notice', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({ id: `r-${index}`, name: `Row ${index}` }));
    render(<DataTable columns={[{ key: 'name', label: '名称' }]} rows={rows} keyField="id" />);
    expect(screen.getByText(/仅显示前 500 行/)).toBeDefined();
    expect(screen.queryByText('Row 99')).not.toBeNull();
    expect(screen.queryByText('Row 100')).toBeNull();
    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 20000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 19500, configurable: true });
    for (let index = 0; index < 5; index += 1) fireEvent.scroll(container);
    expect(screen.queryByText('Row 499')).not.toBeNull();
    expect(screen.queryByText('Row 500')).toBeNull();
  });

  it('does not reveal more rows when scrolled above the load threshold', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ id: `r-${index}`, name: `Row ${index}` }));
    render(<DataTable columns={[{ key: 'name', label: '名称' }]} rows={rows} keyField="id" />);
    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 10000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(container);
    // 未接近底部，可见行数不变
    expect(screen.queryByText('Row 100')).toBeNull();
  });
});
