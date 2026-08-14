// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommunicationWorkflowPage } from './CommunicationWorkflowPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('CommunicationWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders messages and sends them', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return { date: '2026-08-05', config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 }, items: [] };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return {
          items: [
            { id: 'w-1', patientId: 'p-1', status: 'PENDING' },
            { id: 'w-2', patientId: null, status: null },
          ],
          total: 2,
        };
      }
      return {};
    });

    render(<CommunicationWorkflowPage />, { wrapper });
    await screen.findByText('微信通道已开通');
    fireEvent.click((await screen.findAllByRole('button', { name: '发送' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/wechat/w-1/send', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已发送')).toBeDefined();
  });

  it('reports send failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return { date: '2026-08-05', config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 }, items: [] };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [{ id: 'w-1', patientId: 'p-1', status: 'PENDING' }], total: 1 };
      }
      throw new Error('send failed');
    });

    render(<CommunicationWorkflowPage />, { wrapper });
    await screen.findByText('微信通道已开通');
    fireEvent.click(await screen.findByRole('button', { name: '发送' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return { date: '2026-08-05', config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 }, items: [] };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [{ id: 'w-1', patientId: 'p-1', status: 'PENDING' }], total: 1 };
      }
      throw 'boom';
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('发送失败')).toBeDefined();
  });

  it('marks a reminder sent and dismisses another', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return {
          date: '2026-08-05',
          config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 },
          items: [
            { id: 'r-1', patientName: '张三', patientPhone: '13800000000', scene: 'TREATMENT_RECALL', sceneLabel: '治疗后回访', content: '复诊提醒内容一' },
            { id: 'r-2', patientName: '李四', patientPhone: '13900000000', scene: 'FIRST_EXAM_NUDGE', sceneLabel: '首诊跟进', content: '复诊提醒内容二' },
          ],
        };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return {};
    });

    render(<CommunicationWorkflowPage />, { wrapper });
    expect(await screen.findByText('张三')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '已发微信' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/wechat-reminders/r-1/mark-sent', expect.objectContaining({ method: 'POST' }));
    });
    fireEvent.click(screen.getAllByRole('button', { name: '忽略' })[1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/wechat-reminders/r-2/dismiss', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('disables sending when the wechat channel is not configured', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: false, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return { date: '2026-08-05', config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 }, items: [] };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [{ id: 'w-1', patientId: 'p-1', status: 'PENDING' }], total: 1 };
      }
      return {};
    });
    render(<CommunicationWorkflowPage />, { wrapper });

    expect(await screen.findByText('微信通道未开通，发送按钮已禁用')).toBeDefined();
    expect(screen.getByText('请配置 V2_WECHAT_API_URL、V2_WECHAT_APP_ID、V2_WECHAT_APP_SECRET')).toBeDefined();
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows empty states for reminders and messages and copies reminder copy', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return { date: '2026-08-05', config: { enabled: false, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 }, items: [] };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return {};
    });
    render(<CommunicationWorkflowPage />, { wrapper });

    expect(await screen.findByText('今日无待发提醒')).toBeDefined();
    expect(screen.getByText('提醒已停用（设置 wechatReminder.enabled=false）。')).toBeDefined();
    expect(screen.getByText('暂无微信消息')).toBeDefined();
  });

  it('copies reminder content and reports copy failures', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return {
          date: '2026-08-05',
          config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 },
          items: [
            { id: 'r-1', patientName: '张三', patientPhone: '13800000000', scene: 'TREATMENT_RECALL', sceneLabel: '治疗后回访', content: '复诊提醒内容一' },
          ],
        };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return {};
    });
    render(<CommunicationWorkflowPage />, { wrapper });
    expect(await screen.findByText('张三')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '复制话术' }));
    expect(await screen.findByText('话术已复制')).toBeDefined();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('复诊提醒内容一');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    fireEvent.click(screen.getByRole('button', { name: '复制话术' }));
    expect(await screen.findByText('复制失败，请手动选择复制')).toBeDefined();
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalDescriptor);
    }
  });

  it('renders sparse reminders and messages with fallback tags', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return {
          date: '2026-08-05',
          config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 },
          items: [
            { id: 'r-9', patientName: null, patientPhone: null, patientWechatId: null, scene: 'OTHER', sceneLabel: '其他', content: '内容' },
          ],
        };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [{ id: 'w-9', patientName: null, patientId: null, type: null, content: null, status: null }], total: 1 };
      }
      return {};
    });
    render(<CommunicationWorkflowPage />, { wrapper });
    expect(await screen.findByText('未填微信号')).toBeDefined();
    expect(screen.getByText('其他')).toBeDefined();
    expect(screen.getByRole('button', { name: '发送' })).toBeDefined();
  });

  it('renders wechat id variants, default reminder rules and truncated notices', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') return { configured: true, provider: 'http' };
      if (path === '/wechat-reminders/today') {
        return {
          date: '2026-08-05',
          config: { enabled: true },
          truncated: true,
          items: [
            { id: 'r-1', patientName: '张三', patientWechatId: 'wx-1', scene: 'APPOINTMENT', sceneLabel: '预约提醒', content: '内容一' },
          ],
        };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: undefined, total: 0 };
      }
      return {};
    });
    render(<CommunicationWorkflowPage />, { wrapper });
    expect(await screen.findByText('微信：wx-1')).toBeDefined();
    expect(screen.getByText(/自动规则：复诊提醒（提前 1 天）、治疗后回访（3 天后）、首诊跟进（3 天后）/)).toBeDefined();
    expect(screen.getByText('今日提醒超过 1000 条，仅显示前 1000 条')).toBeDefined();
    expect(screen.getByText('暂无微信消息')).toBeDefined();
  });

  it('falls back to an empty reminder list when the payload omits items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/wechat/status') {
        return { configured: true, provider: 'http' };
      }
      if (path === '/wechat-reminders/today') {
        return { date: '2026-08-05', config: { enabled: true, appointmentDaysBefore: 1, recallDaysAfter: 3, firstExamDaysAfter: 3 } };
      }
      if (path === '/resources/wechatMessages?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return {};
    });
    render(<CommunicationWorkflowPage />, { wrapper });
    expect(await screen.findByText('今日无待发提醒')).toBeDefined();
  });
});
