// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TreatmentsPage } from './TreatmentsPage';
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
    if (path === '/resources/treatments?page=1&pageSize=50') {
      return { items: [{ id: 't-1', patientId: 'p-1', doctorId: 'd-1', name: '补牙', price: 10000, status: 'PLANNED' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('TreatmentsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates and transitions treatments', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    expect(await screen.findByText('补牙')).toBeDefined();

    fireEvent.click(screen.getByText('新建治疗'));
await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('治疗名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('价格'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('牙位（逗号分隔）'), { target: { value: '11,21' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 't-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatments', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('治疗记录已创建')).toBeDefined();

    fireEvent.change(await screen.findByLabelText('变更治疗状态'), { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatments/t-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('validates required treatment fields', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    fireEvent.click(screen.getByText('新建治疗'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并填写治疗名称、价格和数量')).toBeDefined();
  });
});
