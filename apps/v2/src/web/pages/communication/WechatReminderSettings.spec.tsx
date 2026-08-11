// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';
import { WechatReminderSettings } from './WechatReminderSettings';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('WechatReminderSettings', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('loads and saves reminder timing settings', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        enabled: true,
        appointmentDaysBefore: 1,
        recallDaysAfter: 3,
        firstExamDaysAfter: 3,
      })
      .mockResolvedValue({ success: true });
    render(<WechatReminderSettings />, { wrapper });

    const appointment = await screen.findByLabelText('复诊提前提醒天数');
    fireEvent.change(appointment, { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('治疗回访延迟天数'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/wechat-reminders/config', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path, options]) => (
      path === '/wechat-reminders/config' && options?.method === 'PATCH'
    ));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      appointmentDaysBefore: 2,
      recallDaysAfter: 5,
    });
  });

  it('shows the loading state and falls back to defaults when the config query fails', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<WechatReminderSettings />, { wrapper });
    expect(screen.getByText('提醒设置加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('config failed'));
    render(<WechatReminderSettings />, { wrapper });
    expect((await screen.findByLabelText('复诊提前提醒天数') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('首诊跟进延迟天数') as HTMLInputElement).value).toBe('3');
    expect((screen.getByRole('checkbox', { name: '启用提醒' }) as HTMLInputElement).checked).toBe(true);
  });

  it('toggles reminders and reports save failures', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      enabled: true,
      appointmentDaysBefore: 1,
      recallDaysAfter: 3,
      firstExamDaysAfter: 3,
    });
    render(<WechatReminderSettings />, { wrapper });
    const toggle = await screen.findByRole('checkbox', { name: '启用提醒' });
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(false);

    vi.mocked(apiRequest).mockRejectedValueOnce('save failed');
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByText('保存提醒设置失败')).toBeDefined();
  });
});
