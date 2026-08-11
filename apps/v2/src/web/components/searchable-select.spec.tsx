// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchableSelect } from './searchable-select';
import { apiRequest } from '../lib/api';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

function mockPages(overrides: Record<string, unknown> = {}) {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    const url = new URL(path, 'http://localhost');
    const page = Number(url.searchParams.get('page') ?? '1');
    const search = url.searchParams.get('search') ?? '';
    if (search) {
      return { items: [{ id: 'p-3', name: '李四' }], total: 1, page: 1, pageSize: 100 };
    }
    if (page >= 10) {
      return { items: [{ id: `p-${page}` }], total: 999, page, pageSize: 100, ...overrides };
    }
    return { items: [{ id: `p-${page}`, name: page === 1 ? '患者甲' : `患者${page}` }], total: 999, page, pageSize: 100, ...overrides };
  });
}

describe('SearchableSelect', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders options and forwards changes', async () => {
    mockPages();
    const onChange = vi.fn();
    render(<SearchableSelect resource="patients" value="" onChange={onChange} ariaLabel="患者" />, { wrapper });
    expect(await screen.findByRole('option', { name: '患者甲' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    expect(onChange).toHaveBeenCalledWith('p-1');
  });

  it('keeps a selected value that is missing from the loaded rows', async () => {
    mockPages();
    render(<SearchableSelect resource="patients" value="p-99" onChange={vi.fn()} ariaLabel="患者" />, { wrapper });
    await screen.findByRole('option', { name: '患者甲' });
    expect((screen.getByLabelText('患者') as HTMLSelectElement).querySelector('option[value="p-99"]')).not.toBeNull();
  });

  it('searches, resets the page and reports query errors', async () => {
    mockPages();
    render(<SearchableSelect resource="patients" value="" onChange={vi.fn()} ariaLabel="患者" />, { wrapper });
    await screen.findByRole('option', { name: '患者甲' });
    fireEvent.change(screen.getByLabelText('患者搜索'), { target: { value: '李' } });
    expect(await screen.findByRole('option', { name: '李四' })).toBeDefined();
    expect(screen.queryByRole('option', { name: '患者甲' })).toBeNull();
  });

  it('loads more pages and caps at ten pages', async () => {
    mockPages();
    render(<SearchableSelect resource="patients" value="" onChange={vi.fn()} ariaLabel="患者" />, { wrapper });
    await screen.findByRole('option', { name: '患者甲' });
    for (let index = 0; index < 9; index += 1) {
      const button = await screen.findByRole('button', { name: /加载更多/ });
      fireEvent.click(button);
    }
    expect(await screen.findByText(/数据较多，仅展示前 10 条/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /加载更多/ })).toBeNull();
  });

  it('invokes onLoaded with merged rows', async () => {
    mockPages();
    const onLoaded = vi.fn();
    render(<SearchableSelect resource="patients" value="" onChange={vi.fn()} ariaLabel="患者" onLoaded={onLoaded} />, { wrapper });
    await screen.findByRole('option', { name: '患者甲' });
    await waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'p-1' })]));
    });
  });

  it('passes filter params and a custom page size', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    render(
      <SearchableSelect
        resource="items"
        value=""
        onChange={vi.fn()}
        ariaLabel="物品"
        pageSize={50}
        filterParams={{ clinicId: 'c1', empty: '' }}
      />,
      { wrapper },
    );
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/items?page=1&pageSize=50&clinicId=c1');
    });
  });
});
