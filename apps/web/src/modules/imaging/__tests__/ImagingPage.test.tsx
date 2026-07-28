import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseImagingList = vi.fn();
const mockUseCreateImaging = vi.fn();
const mockUseDeleteImaging = vi.fn();
const mockUseStaff = vi.fn();

vi.mock('@/lib/api/content/imaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/content/imaging')>();
  return {
    ...actual,
    useImagingList: (...args: unknown[]) => mockUseImagingList(...args),
    useCreateImaging: (...args: unknown[]) => mockUseCreateImaging(...args),
    useDeleteImaging: (...args: unknown[]) => mockUseDeleteImaging(...args),
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

import ImagingPage from '../ImagingPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ImagingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseImagingList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateImaging.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseDeleteImaging.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseStaff.mockReturnValue({ data: [], isLoading: false });

    renderWithProviders();

    expect(screen.getByText('影像管理')).toBeInTheDocument();
  });
});
