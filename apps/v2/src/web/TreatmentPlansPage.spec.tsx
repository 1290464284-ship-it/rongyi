// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TreatmentPlansPage } from './TreatmentPlansPage';
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
    if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
      return { items: [{ id: 'plan-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=200') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('TreatmentPlansPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates treatment plans with item details', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    expect(await screen.findByText('正畸计划')).toBeDefined();

    fireEvent.click(screen.getByText('新建治疗计划'));
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '种植计划' } });
    fireEvent.change(screen.getByLabelText('明细名称'), { target: { value: '种植体' } });
    fireEvent.change(screen.getByLabelText('明细单价'), { target: { value: '5000' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'plan-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlans', expect.objectContaining({ method: 'POST' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlanItems', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('治疗计划已创建')).toBeDefined();
  });

  it('validates required plan fields', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getByText('新建治疗计划'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并填写计划名称和至少一条有效明细')).toBeDefined();
  });
});
