import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock API hooks
const mockUseRegistrations = vi.fn();
const mockUseCreateRegistration = vi.fn();
const mockUseTriageRegistration = vi.fn();
const mockUseStartVisitRegistration = vi.fn();
const mockUseCompleteRegistration = vi.fn();
const mockUseCancelRegistration = vi.fn();

vi.mock('@/lib/api/clinical/registrations', () => ({
  useRegistrations: (...args: unknown[]) => mockUseRegistrations(...args),
  useCreateRegistration: (...args: unknown[]) => mockUseCreateRegistration(...args),
  useTriageRegistration: (...args: unknown[]) => mockUseTriageRegistration(...args),
  useStartVisitRegistration: (...args: unknown[]) => mockUseStartVisitRegistration(...args),
  useCompleteRegistration: (...args: unknown[]) => mockUseCompleteRegistration(...args),
  useCancelRegistration: (...args: unknown[]) => mockUseCancelRegistration(...args),
  REGISTRATION_STATUS_LABEL: { REGISTERED: '已挂号', TRIAGED: '已分诊', IN_PROGRESS: '接诊中', COMPLETED: '已完成' },
  REGISTRATION_STATUS_COLOR: { REGISTERED: 'bg-blue-100', TRIAGED: 'bg-yellow-100', IN_PROGRESS: 'bg-green-100', COMPLETED: 'bg-gray-100' },
  REGISTRATION_TYPE_LABEL: { FIRST_VISIT: '初诊', RETURN_VISIT: '复诊', EMERGENCY: '急诊' },
  REGISTRATION_TYPE_COLOR: { FIRST_VISIT: 'bg-blue-100', RETURN_VISIT: 'bg-green-100', EMERGENCY: 'bg-red-100' },
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

import RegistrationPage from '../RegistrationPage';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RegistrationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseRegistrations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseTriageRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseStartVisitRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCancelRegistration.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('就诊任务')).toBeInTheDocument();
  });

  it('渲染新建挂号按钮', () => {
    mockUseRegistrations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseTriageRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseStartVisitRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCancelRegistration.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('新建挂号')).toBeInTheDocument();
  });

  it('显示 Tab 导航', () => {
    mockUseRegistrations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseTriageRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseStartVisitRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCancelRegistration.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('挂号列表')).toBeInTheDocument();
    expect(screen.getByText('分诊列表')).toBeInTheDocument();
    expect(screen.getByText('接诊中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('无数据时显示空状态', () => {
    mockUseRegistrations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseTriageRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseStartVisitRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCancelRegistration.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('显示搜索框', () => {
    mockUseRegistrations.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseTriageRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseStartVisitRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCompleteRegistration.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseCancelRegistration.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByPlaceholderText('搜索患者姓名/编号/电话/医生/主诉')).toBeInTheDocument();
  });
});
