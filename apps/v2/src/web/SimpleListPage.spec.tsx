// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SimpleListPage } from './SimpleListPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('SimpleListPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows loading state', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<SimpleListPage title="Report" endpoint="/stats/revenue" />, { wrapper });
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('renders formatted report rows', async () => {
    vi.mocked(apiRequest).mockResolvedValue([
      { amount: 10, nested: { value: 1 }, label: '2026-08' },
    ]);
    render(<SimpleListPage title="Report" endpoint="/stats/revenue" />, { wrapper });
    expect(await screen.findByText('Report')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('{"value":1}')).toBeDefined();
    expect(screen.getByText('2026-08')).toBeDefined();
  });

  it('renders empty state', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    render(<SimpleListPage title="Empty" endpoint="/stats/empty" />, { wrapper });
    expect(await screen.findByText('No data.')).toBeDefined();
  });

  it('renders error state', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('report failed'));
    render(<SimpleListPage title="Error" endpoint="/stats/error" />, { wrapper });
    expect(await screen.findByText('report failed')).toBeDefined();
  });
});
