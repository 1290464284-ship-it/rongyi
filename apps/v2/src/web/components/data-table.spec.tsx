// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataTable } from './data-table';

// A15：真虚拟化——只渲染可视窗口 + 上下过扫描行（jsdom 下行高恒为缺省 36px）
describe('DataTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('windows large row sets and reveals more on scroll', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ id: `r-${index}`, name: `Row ${index}` }));
    render(<DataTable columns={[{ key: 'name', label: '名称' }]} rows={rows} keyField="id" />);
    // 初始只渲染头部窗口（过扫描行）
    expect(screen.queryByText('Row 0')).not.toBeNull();
    expect(screen.queryByText('Row 15')).not.toBeNull();
    expect(screen.queryByText('Row 99')).toBeNull();

    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 5400, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 5000, configurable: true });
    fireEvent.scroll(container);
    // 滚动后渲染尾部窗口：末行可见、头部行卸载
    expect(screen.queryByText('Row 149')).not.toBeNull();
    expect(screen.queryByText('Row 140')).not.toBeNull();
    expect(screen.queryByText('Row 99')).toBeNull();
    expect(screen.queryByText('Row 0')).toBeNull();
  });

  it('keeps the 500-row cap and its notice', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({ id: `r-${index}`, name: `Row ${index}` }));
    render(<DataTable columns={[{ key: 'name', label: '名称' }]} rows={rows} keyField="id" />);
    expect(screen.getByText(/仅显示前 500 行/)).toBeDefined();
    expect(screen.queryByText('Row 0')).not.toBeNull();
    expect(screen.queryByText('Row 99')).toBeNull();
    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 20000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 19500, configurable: true });
    fireEvent.scroll(container);
    expect(screen.queryByText('Row 499')).not.toBeNull();
    expect(screen.queryByText('Row 500')).toBeNull();
  });

  it('keeps the head window when scrolled to the top', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ id: `r-${index}`, name: `Row ${index}` }));
    render(<DataTable columns={[{ key: 'name', label: '名称' }]} rows={rows} keyField="id" />);
    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 5400, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(container);
    // 顶部：中部行仍未渲染
    expect(screen.queryByText('Row 99')).toBeNull();
    expect(screen.queryByText('Row 0')).not.toBeNull();
  });
});
