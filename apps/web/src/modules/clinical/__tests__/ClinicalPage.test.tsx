import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock API hooks
const mockUseVisitsList = vi.fn();
const mockUseCreateVisit = vi.fn();
const mockUseCompleteVisit = vi.fn();
const mockUseAppointments = vi.fn();

vi.mock('@/lib/api/clinical/visits', () => ({
  useVisitsList: (...args: unknown[]) => mockUseVisitsList(...args),
  useCreateVisit: (...args: unknown[]) => mockUseCreateVisit(...args),
  useCompleteVisit: (...args: unknown[]) => mockUseCompleteVisit(...args),
  VISIT_STATUS_LABEL: { IN_PROGRESS: '就诊中', COMPLETED: '已完成', CANCELLED: '已取消' },
  VISIT_STATUS_COLOR: { IN_PROGRESS: 'bg-warning', COMPLETED: 'bg-success', CANCELLED: 'bg-muted' },
}));

vi.mock('@/lib/api/clinical/appointments', () => ({
  useAppointments: (...args: unknown[]) => mockUseAppointments(...args),
  APPOINTMENT_STATUS_LABEL: { BOOKED: '已预约', ARRIVED: '已到达' },
  APPOINTMENT_STATUS_COLOR: { BOOKED: 'bg-blue-100', ARRIVED: 'bg-green-100' },
}));

vi.mock('@/lib/staff', () => ({
  useStaff: () => ({ data: [] }),
}));

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: '1', role: 'DOCTOR' } }),
}));

vi.mock('@/components/patient/PatientSelector', () => ({
  PatientSelector: () => <div data-testid="patient-selector" />,
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    formatDate: (d: string) => d?.slice(0, 10) ?? '',
    debounce: (fn: () => void) => {
      const debounced = () => fn();
      debounced.cancel = vi.fn();
      return debounced;
    },
  };
});

import ClinicalPage from '../ClinicalPage';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ClinicalPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClinicalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseVisitsList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseCreateVisit.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteVisit.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('就诊任务')).toBeInTheDocument();
  });

  it('渲染开始就诊按钮', () => {
    mockUseVisitsList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseCreateVisit.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteVisit.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('开始就诊')).toBeInTheDocument();
  });

  it('无就诊记录时显示空状态', () => {
    mockUseVisitsList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseCreateVisit.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteVisit.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('暂无就诊记录')).toBeInTheDocument();
  });

  it('显示搜索框', () => {
    mockUseVisitsList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseCreateVisit.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteVisit.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByPlaceholderText('搜索患者/医生/主诉')).toBeInTheDocument();
  });

  it('显示状态筛选下拉框', () => {
    mockUseVisitsList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseCreateVisit.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteVisit.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('全部状态')).toBeInTheDocument();
  });
});
