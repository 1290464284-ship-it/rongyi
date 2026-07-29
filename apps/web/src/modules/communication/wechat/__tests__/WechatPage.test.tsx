import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/communication/wechat', () => ({
  useWechatMessages: () => ({ data: [], isLoading: false }),
  useBirthdayPatients: () => ({ data: [], isLoading: false }),
  useAppointmentReminders: () => ({ data: [], isLoading: false }),
  useSendWechat: () => ({ mutate: vi.fn(), isPending: false }),
  useSendBatchWechat: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '', formatDateTime: (d: string) => d?.slice(0, 16) ?? '' };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import WechatPage from '../WechatPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WechatPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WechatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    renderWithProviders();
    expect(screen.getByText('微信提醒')).toBeInTheDocument();
  });
});
