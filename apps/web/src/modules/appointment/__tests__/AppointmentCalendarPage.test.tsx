import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock API hooks
const mockUseAppointments = vi.fn();
const mockUseUpdateAppointment = vi.fn();
const mockUseDeleteAppointment = vi.fn();

vi.mock('@/lib/api/clinical/appointments', () => ({
  useAppointments: (...args: unknown[]) => mockUseAppointments(...args),
  useUpdateAppointment: () => mockUseUpdateAppointment(),
  useDeleteAppointment: () => mockUseDeleteAppointment(),
  APPOINTMENT_STATUS_LABEL: {
    BOOKED: '已预约',
    ARRIVED: '已到诊',
    IN_CHAIR: '就诊中',
    COMPLETED: '已完成',
    NO_SHOW: '爽约',
    CANCELLED: '已取消',
  },
  APPOINTMENT_STATUS_COLOR: {
    BOOKED: 'bg-blue-100',
    ARRIVED: 'bg-green-100',
  },
  APPOINTMENT_TYPE_LABEL: {
    FIRST_VISIT: '初诊',
    FOLLOW_UP: '复诊',
  },
  APPOINTMENT_TYPE_COLOR: {
    FIRST_VISIT: 'bg-blue-500',
    FOLLOW_UP: 'bg-green-500',
  },
}));

// Mock chairs hook
const mockUseChairs = vi.fn();
vi.mock('@/lib/chairs', () => ({
  useChairs: () => mockUseChairs(),
}));

// Mock AppointmentForm
vi.mock('../AppointmentForm', () => ({
  default: () => <div data-testid="appointment-form">预约表单</div>,
}));

import AppointmentCalendarPage from '../AppointmentCalendarPage';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppointmentCalendarPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppointmentCalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChairs.mockReturnValue({ data: [] });
    mockUseUpdateAppointment.mockReturnValue({ mutate: vi.fn() });
    mockUseDeleteAppointment.mockReturnValue({ mutate: vi.fn() });
  });

  it('渲染页面标题和新建按钮', () => {
    mockUseAppointments.mockReturnValue({
      data: { items: [] },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('预约排班')).toBeInTheDocument();
    expect(screen.getByText('新建预约')).toBeInTheDocument();
  });

  it('渲染视图切换按钮', () => {
    mockUseAppointments.mockReturnValue({
      data: { items: [] },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('日')).toBeInTheDocument();
    expect(screen.getByText('周')).toBeInTheDocument();
    expect(screen.getByText('月')).toBeInTheDocument();
  });

  it('渲染导航按钮', () => {
    mockUseAppointments.mockReturnValue({
      data: { items: [] },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('今天')).toBeInTheDocument();
  });

  it('加载中正常渲染', () => {
    mockUseAppointments.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithProviders();

    expect(screen.getByText('预约排班')).toBeInTheDocument();
  });

  it('有预约数据时正常渲染', () => {
    mockUseAppointments.mockReturnValue({
      data: {
        items: [
          {
            id: '1',
            patientId: 'p1',
            patient: { id: 'p1', name: '张三' },
            startTime: '2024-01-15T09:00:00+08:00',
            endTime: '2024-01-15T10:00:00+08:00',
            type: 'FIRST_VISIT',
            status: 'BOOKED',
            chairId: null,
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders();

    expect(screen.getByText('预约排班')).toBeInTheDocument();
  });

  it('展示状态图例：已预约/已到诊/就诊中/已完成/爽约/已取消', () => {
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    renderWithProviders();

    expect(screen.getByText('已预约')).toBeInTheDocument();
    expect(screen.getByText('已到诊')).toBeInTheDocument();
    expect(screen.getByText('就诊中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('爽约')).toBeInTheDocument();
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });

  it('展示牙椅筛选下拉框且默认"全部牙椅"', () => {
    mockUseAppointments.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseChairs.mockReturnValue({ data: [] });
    renderWithProviders();

    expect(screen.getByText('牙椅')).toBeInTheDocument();
    expect(screen.getByText('全部牙椅')).toBeInTheDocument();
  });

  it('isLoading 时显示"加载中…"提示', () => {
    mockUseAppointments.mockReturnValue({ data: undefined, isLoading: true });
    renderWithProviders();

    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });
});
