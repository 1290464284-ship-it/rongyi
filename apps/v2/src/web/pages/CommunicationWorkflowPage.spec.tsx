// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommunicationWorkflowPage } from './CommunicationWorkflowPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
    expect(await screen.findByText('send failed')).toBeDefined();

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
});
