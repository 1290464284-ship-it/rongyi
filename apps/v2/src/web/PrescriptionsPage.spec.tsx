// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrescriptionsPage } from './PrescriptionsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/prescriptions?page=1&pageSize=50') {
      return { items: [{ id: 'pres-1', patientId: 'p-1', doctorId: 'd-1', remark: '饭后服用' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('PrescriptionsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates prescriptions with item details', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    expect(await screen.findByText('饭后服用')).toBeDefined();

    fireEvent.click(screen.getByText('新建处方'));
await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('药品名称'), { target: { value: '阿莫西林' } });
    fireEvent.change(screen.getByLabelText('频次'), { target: { value: '每日三次' } });
    fireEvent.change(screen.getByLabelText('天数'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '10' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'pres-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptions', expect.objectContaining({ method: 'POST' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptionItems', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('处方已创建')).toBeDefined();
  });

  it('validates required prescription fields', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');
    fireEvent.click(screen.getByText('新建处方'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并至少填写一条有效处方明细')).toBeDefined();
  });
});
