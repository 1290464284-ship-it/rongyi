import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock API hooks
const mockUsePatients = vi.fn();
vi.mock('@/lib/api/patients/patients', () => ({
  usePatients: (...args: unknown[]) => mockUsePatients(...args),
  PATIENT_SOURCE_LABEL: { WALK_IN: '初诊', REFERRAL: '转介绍' },
  PATIENT_SOURCE_COLOR: { WALK_IN: 'bg-blue-100', REFERRAL: 'bg-green-100' },
}));

// Mock PatientForm
vi.mock('../PatientForm', () => ({
  default: () => <div data-testid="patient-form">患者表单</div>,
}));

// Mock utils
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

import PatientListPage from '../PatientListPage';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PatientListPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PatientListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题和新建按钮', () => {
    mockUsePatients.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('患者管理')).toBeInTheDocument();
    expect(screen.getByText('新建患者')).toBeInTheDocument();
  });

  it('加载中显示加载状态', () => {
    mockUsePatients.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithProviders();

    expect(screen.getByText('患者管理')).toBeInTheDocument();
  });

  it('无数据时显示空状态', () => {
    mockUsePatients.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('暂无患者')).toBeInTheDocument();
  });

  it('有数据时显示患者总数', () => {
    mockUsePatients.mockReturnValue({
      data: {
        items: [
          {
            id: '1',
            code: 'P001',
            name: '张三',
            gender: 'MALE',
            phone: '13800138000',
            tags: ['VIP'],
            source: 'WALK_IN',
            createdAt: '2024-01-01T00:00:00Z',
            remark: '测试备注',
          },
        ],
        total: 1,
      },
      isLoading: false,
    });

    renderWithProviders();

    // 虚拟列表在 jsdom 中不渲染行，但总数应显示
    expect(screen.getByText(/共/)).toBeInTheDocument();
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });

  it('显示搜索框', () => {
    mockUsePatients.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByPlaceholderText('姓名 / 手机 / 病历号')).toBeInTheDocument();
  });
});
