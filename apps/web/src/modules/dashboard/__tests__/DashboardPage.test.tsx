import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// Mock useDashboard
const mockUseDashboard = vi.fn();
vi.mock('@/lib/api/system/stats', () => ({
  useDashboard: () => mockUseDashboard(),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import DashboardPage from '../DashboardPage';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

const mockDashboardData = {
  today: {
    appointments: 5,
    visits: 3,
  },
  finance: {
    unpaidAmount: 3500,
    monthRevenue: 50000,
    monthChargeCount: 120,
    unpaidCount: 5,
  },
  patients: {
    total: 120,
    recent: [
      { id: '1', name: '张三', phone: '13800138000', createdAt: '2026-01-01' },
    ],
  },
  pendingCharges: [],
  pendingFollowUps: 8,
  recentAppointments: [
    { id: '1', patientName: '张三', time: '09:00', status: '已完成' },
    { id: '2', patientName: '李四', time: '10:30', status: '进行中' },
  ],
  revenueChart: { labels: ['周一', '周二'], data: [5000, 3500] },
};

describe('DashboardPage', () => {
  it('加载中显示骨架屏', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    renderDashboard();
    // 骨架屏使用 animate-pulse 类
    const skeletonElements = document.querySelectorAll('.animate-pulse');
    expect(skeletonElements.length).toBeGreaterThan(0);
  });

  it('加载失败显示错误信息', () => {
    mockUseDashboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('网络错误'),
    });
    renderDashboard();
    expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });

  it('成功加载后显示仪表盘数据', () => {
    mockUseDashboard.mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderDashboard();
    // 验证关键指标卡片渲染
    expect(screen.getByText('今日预约')).toBeInTheDocument();
    expect(screen.getByText(/总患者数/)).toBeInTheDocument();
  });

  it('data 为 null 时不渲染内容', () => {
    mockUseDashboard.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    const { container } = renderDashboard();
    expect(container.firstChild).toBeNull();
  });
});
