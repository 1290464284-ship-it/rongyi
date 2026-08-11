// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CostShareTab } from './hub-tabs';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../lib/api';

const mockApiRequest = vi.mocked(apiRequest);

describe('CostShareTab', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockApiRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders cost-share summary rows with formatted money', async () => {
    mockApiRequest.mockResolvedValue({
      rows: [
        { costType: 'SERVICE', category: '根管治疗', total: 123456, itemCount: 2, chargeCount: 1 },
        { costType: 'MATERIAL', category: '充填材料', total: 7890, itemCount: 3, chargeCount: 2 },
      ],
      summary: {
        SERVICE: { total: 123456, itemCount: 2, chargeCount: 1 },
        MATERIAL: { total: 7890, itemCount: 3, chargeCount: 2 },
        grandTotal: 131346,
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CostShareTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/技术服务合计/)).toBeDefined();
    expect(screen.getAllByText(/¥1234\.56/)).toHaveLength(2);
    expect(screen.getAllByText(/¥78\.90/)).toHaveLength(2);
    expect(screen.getByText(/¥1313\.46/)).toBeDefined();
    expect(screen.getByText('技术服务')).toBeDefined();
    expect(screen.getByText('材料耗材')).toBeDefined();
    expect(mockApiRequest).toHaveBeenCalledWith('/stats/cost-share');
  });

  it('shows an error message when the stats request fails', async () => {
    mockApiRequest.mockRejectedValue(new Error('分账统计加载失败'));

    render(
      <QueryClientProvider client={queryClient}>
        <CostShareTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('分账统计加载失败')).toBeDefined();
  });

  it('shows an empty state without rows', async () => {
    mockApiRequest.mockResolvedValue({ rows: [], summary: {} });

    render(
      <QueryClientProvider client={queryClient}>
        <CostShareTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('暂无收费明细数据')).toBeDefined();
  });

  it('falls back to zero summaries and renders unknown cost types', async () => {
    mockApiRequest.mockResolvedValue({
      rows: [
        { costType: 'OTHER', category: '其他', total: 0, itemCount: 0, chargeCount: 0 },
        { costType: undefined, category: '未知', total: 0, itemCount: 0, chargeCount: 0 },
      ],
      summary: {},
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CostShareTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('其他')).toBeDefined();
    expect(screen.getByText('未知')).toBeDefined();
    expect(screen.getAllByText(/¥0\.00/).length).toBeGreaterThan(0);
  });
});
