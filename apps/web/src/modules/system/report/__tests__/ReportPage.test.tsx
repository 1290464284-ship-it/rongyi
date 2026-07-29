import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all chart components (lazy-loaded)
vi.mock('./charts/RevenueLineChart', () => ({ default: () => <div data-testid="revenue-line-chart" /> }));
vi.mock('./charts/CategoryPieChart', () => ({ default: () => <div data-testid="category-pie-chart" /> }));
vi.mock('./charts/PayMethodDoughnutChart', () => ({ default: () => <div data-testid="pay-method-chart" /> }));
vi.mock('./charts/PatientGrowthChart', () => ({ default: () => <div data-testid="patient-growth-chart" /> }));
vi.mock('./charts/RevenueCategoryPieChart', () => ({ default: () => <div data-testid="revenue-category-chart" /> }));
vi.mock('./charts/RevenueDoctorBarChart', () => ({ default: () => <div data-testid="revenue-doctor-chart" /> }));
vi.mock('./charts/AppointmentPieChart', () => ({ default: () => <div data-testid="appointment-pie-chart" /> }));
vi.mock('./charts/MemberLevelPieChart', () => ({ default: () => <div data-testid="member-level-chart" /> }));

vi.mock('@/lib/api/system/stats', () => ({
  useRevenue: () => ({ data: null, isLoading: false }),
  usePatientGrowth: () => ({ data: null, isLoading: false }),
  useRevenueByCategory: () => ({ data: [], isLoading: false }),
  useRevenueByDoctor: () => ({ data: [], isLoading: false }),
  useInventoryStatus: () => ({ data: null, isLoading: false }),
  useAppointmentStatusStats: () => ({ data: [], isLoading: false }),
  useMemberStats: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/lib/api/clinical/appointments', () => ({
  APPOINTMENT_STATUS_LABEL: { CONFIRMED: '已确认', PENDING: '待确认', CANCELLED: '已取消' },
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '', formatMoney: (n: number) => `¥${n}` };
});

import ReportPage from '../ReportPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    renderWithProviders();
    expect(screen.getByText('经营报表')).toBeInTheDocument();
  });
});
