// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SimpleListPage } from './SimpleListPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from './toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('SimpleListPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows loading state', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<SimpleListPage title="Report" endpoint="/stats/revenue" />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
  });

  it('renders formatted report rows', async () => {
    vi.mocked(apiRequest).mockResolvedValue([
      { amount: 10, nested: { value: 1 }, label: '2026-08', empty: null },
    ]);
    render(<SimpleListPage title="Report" endpoint="/stats/revenue" />, { wrapper });
    expect(await screen.findByText('Report')).toBeDefined();
    expect(screen.getByText('¥0.10')).toBeDefined();
    expect(screen.getByText('{"value":1}')).toBeDefined();
    expect(screen.getByText('2026-08')).toBeDefined();
  });

  it('renders an empty state when the endpoint returns no data', async () => {
    vi.mocked(apiRequest).mockResolvedValue(null as unknown as unknown[]);
    render(<SimpleListPage title="Empty" endpoint="/stats/empty" />, { wrapper });
    expect(await screen.findByText('暂无数据')).toBeDefined();
  });

  it('shows a truncation notice for wrapped list responses', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [{ id: 'r-1', name: 'Row' }], truncated: true });
    render(<SimpleListPage title="RFM" endpoint="/analytics/rfm" />, { wrapper });
    expect(await screen.findByText('\u8d85\u8fc7\u663e\u793a\u4e0a\u9650\uff0c\u4ec5\u663e\u793a\u90e8\u5206\u6570\u636e')).toBeDefined();
    expect(screen.getByText('Row')).toBeDefined();
  });

  it('renders empty state', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    render(<SimpleListPage title="Empty" endpoint="/stats/empty" />, { wrapper });
    expect(await screen.findByText('暂无数据')).toBeDefined();
  });

  it('renders error state', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('report failed'));
    render(<SimpleListPage title="Error" endpoint="/stats/error" />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });
});
