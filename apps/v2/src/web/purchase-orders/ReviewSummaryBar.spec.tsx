// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewSummaryBar } from './ReviewSummaryBar';
import { apiRequest } from '../lib/api';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('ReviewSummaryBar', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows placeholders while loading', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<ReviewSummaryBar refreshKey={0} />, { wrapper });
    expect(screen.getByText('待审核 —')).toBeDefined();
    expect(screen.getByText('待收货 —')).toBeDefined();
  });

  it('renders submitted and approved counts', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ submitted: 2, approved: 3 });
    render(<ReviewSummaryBar refreshKey={0} />, { wrapper });
    expect(await screen.findByText('待审核 2 单')).toBeDefined();
    expect(screen.getByText('待收货 3 单')).toBeDefined();
  });

  it('falls back to zero counts when the stats request fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('stats failed'));
    render(<ReviewSummaryBar refreshKey={0} />, { wrapper });
    expect(await screen.findByText('待审核 0 单')).toBeDefined();
    expect(screen.getByText('待收货 0 单')).toBeDefined();
  });
});
