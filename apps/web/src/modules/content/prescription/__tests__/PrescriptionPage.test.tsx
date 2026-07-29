import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUsePrescriptions = vi.fn();
const mockUseCreatePrescription = vi.fn();
const mockUseDeletePrescription = vi.fn();
const mockUseStaff = vi.fn();

vi.mock('@/lib/api/content/prescriptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/content/prescriptions')>();
  return {
    ...actual,
    usePrescriptions: (...args: unknown[]) => mockUsePrescriptions(...args),
    useCreatePrescription: (...args: unknown[]) => mockUseCreatePrescription(...args),
    useDeletePrescription: (...args: unknown[]) => mockUseDeletePrescription(...args),
  };
});

vi.mock('@/lib/staff', () => ({
  useStaff: (...args: unknown[]) => mockUseStaff(...args),
}));

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: () => ({ user: null }),
}));

vi.mock('@/components/patient/PatientSelector', () => ({
  PatientSelector: () => null,
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '' };
});

import PrescriptionPage from '../PrescriptionPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PrescriptionPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PrescriptionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUsePrescriptions.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreatePrescription.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUseDeletePrescription.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseStaff.mockReturnValue({ data: [], isLoading: false });

    renderWithProviders();

    expect(screen.getByText('处方管理')).toBeInTheDocument();
  });
});
