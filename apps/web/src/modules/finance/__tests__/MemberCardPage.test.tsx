import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseMemberCards = vi.fn();
const mockUseRechargeMemberCard = vi.fn();
const mockUseCreateMemberCard = vi.fn();
const mockUseMemberCardLogs = vi.fn();
const mockUsePatients = vi.fn();

vi.mock('@/lib/api/financial/member-cards', () => ({
  useMemberCards: (...args: unknown[]) => mockUseMemberCards(...args),
  useRechargeMemberCard: (...args: unknown[]) => mockUseRechargeMemberCard(...args),
  useCreateMemberCard: (...args: unknown[]) => mockUseCreateMemberCard(...args),
  useMemberCardLogs: (...args: unknown[]) => mockUseMemberCardLogs(...args),
}));

vi.mock('@/lib/api/patients/patients', () => ({
  usePatients: (...args: unknown[]) => mockUsePatients(...args),
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    formatDate: (d: string) => d?.slice(0, 10) ?? '',
    formatDateTime: (d: string) => d?.slice(0, 16) ?? '',
  };
});

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: () => ({ user: null }),
}));

import MemberCardPage from '../MemberCardPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MemberCardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MemberCardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseMemberCards.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseRechargeMemberCard.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseCreateMemberCard.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseMemberCardLogs.mockReturnValue({ data: [], isLoading: false });
    mockUsePatients.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWithProviders();

    expect(screen.getByText('会员卡管理')).toBeInTheDocument();
  });
});
