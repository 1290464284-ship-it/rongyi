import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseTreatmentPlans = vi.fn();
const mockUseCreateTreatmentPlan = vi.fn();

vi.mock('@/lib/api/clinical/treatment-plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/clinical/treatment-plans')>();
  return {
    ...actual,
    useTreatmentPlans: (...args: unknown[]) => mockUseTreatmentPlans(...args),
    useCreateTreatmentPlan: (...args: unknown[]) => mockUseCreateTreatmentPlan(...args),
  };
});

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '' };
});

import TreatmentPlanPage from '../TreatmentPlanPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TreatmentPlanPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TreatmentPlanPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseTreatmentPlans.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateTreatmentPlan.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('治疗计划')).toBeInTheDocument();
  });
});
