// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TreatmentsPage } from './TreatmentsPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

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

  it('creates a treatment with cents payload and transitions status', async () => {
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
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/treatments' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      name: '洁牙',
      category: 'GENERAL',
      price: 20000,
      quantity: 1,
      teethNumbers: ['11', '21'],
      status: 'PLANNED',
    });
    expect(body.code).toMatch(/^T-\d+$/);
    expect(body.plannedDate).toBeUndefined();
    expect(await screen.findByText('治疗记录已创建')).toBeDefined();

    fireEvent.change(await screen.findByLabelText('变更治疗状态'), { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatments/t-1/status', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      }));
    });
    expect(await screen.findByText('治疗状态已更新')).toBeDefined();
  });

  it('edits a treatment with backfilled cents-to-yuan and PATCH payload', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('患者') as HTMLSelectElement).value).toBe('p-1');
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('医生') as HTMLSelectElement).value).toBe('d-1');
    expect((screen.getByLabelText('治疗名称') as HTMLInputElement).value).toBe('补牙');
    expect((screen.getByLabelText('价格') as HTMLInputElement).value).toBe('100.00');
    expect((screen.getByLabelText('牙位（逗号分隔）') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('PLANNED');

    fireEvent.change(screen.getByLabelText('治疗名称'), { target: { value: '补牙(升级)' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 't-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatments/t-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/treatments/t-1' && (call[1] as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ name: '补牙(升级)', price: 10000, quantity: 1, teethNumbers: [], status: 'PLANNED' });
    expect(await screen.findByText('治疗记录已更新')).toBeDefined();
  });

  it('deletes a treatment after confirmation', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatments/t-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('治疗记录已删除')).toBeDefined();
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
