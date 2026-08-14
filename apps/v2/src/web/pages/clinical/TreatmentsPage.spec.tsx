// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TreatmentsPage } from './TreatmentsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

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
    expect(body).toMatchObject({ name: '补牙(升级)', price: 10000, quantity: 1, teethNumbers: [] });
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

  it('shows loading, error, and empty states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<TreatmentsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('treatments failed'));
    render(<TreatmentsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    render(<TreatmentsPage />, { wrapper });
    expect(await screen.findByText('暂无治疗')).toBeDefined();
  });

  it('keeps the treatment when delete confirmation is cancelled', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith(
      '/resources/treatments/t-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('fills every treatment field and rejects zero price', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');

    fireEvent.click(screen.getByText('新建治疗'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('项目编码'), { target: { value: 'T-001' } });
    fireEvent.change(screen.getByLabelText('治疗名称'), { target: { value: '全瓷冠' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'PROSTHETIC' } });
    fireEvent.change(screen.getByLabelText('价格'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并填写治疗名称、价格和数量')).toBeDefined();

    fireEvent.change(screen.getByLabelText('价格'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('计划日期'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('完成日期'), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '两日后复诊' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 't-3' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatments', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/treatments');
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      code: 'T-001',
      category: 'PROSTHETIC',
      price: 30000,
      quantity: 2,
      plannedDate: '2026-08-10',
      completedDate: '2026-08-12',
      remark: '两日后复诊',
    });
    expect(await screen.findByText('治疗记录已创建')).toBeDefined();
  });

  it('renders fallback labels and prefills sparse rows', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatments?page=1&pageSize=50') {
        return { items: [{ id: 't-x', status: 'UNKNOWN' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      return {};
    });
    render(<TreatmentsPage />, { wrapper });
    expect(await screen.findByText('UNKNOWN')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('项目编码') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('数量') as HTMLInputElement).value).toBe('1');
    });
  });

  it('rejects zero quantity', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    fireEvent.click(screen.getByText('新建治疗'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('治疗名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('价格'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '0' } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    expect(await screen.findByText('请选择患者、医生并填写治疗名称、价格和数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/treatments', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects an empty quantity', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    fireEvent.click(screen.getByText('新建治疗'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('治疗名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('价格'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '' } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    expect(await screen.findByText('请选择患者、医生并填写治疗名称、价格和数量')).toBeDefined();
  });

  it('renders an empty status cell for rows without a status', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatments?page=1&pageSize=50') {
        return { items: [{ id: 't-null', name: '无状态治疗', status: null }], total: 1, page: 1, pageSize: 50 };
      }
      return {};
    });
    render(<TreatmentsPage />, { wrapper });
    expect(await screen.findByText('无状态治疗')).toBeDefined();
  });

  it('ignores a second status transition while the first is in flight', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    let resolveStatus: (() => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/treatments/t-1/status') {
        return new Promise<void>((resolve) => { resolveStatus = resolve; });
      }
      if (path === '/resources/treatments?page=1&pageSize=50') {
        return { items: [{ id: 't-1', patientId: 'p-1', doctorId: 'd-1', name: '补牙', price: 10000, status: 'PLANNED' }], total: 1, page: 1, pageSize: 50 };
      }
      return {};
    });
    const select = screen.getByLabelText('变更治疗状态') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'IN_PROGRESS' } });
    fireEvent.change(select, { target: { value: 'DONE' } });
    await waitFor(() => {
      const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/treatments/t-1/status');
      expect(calls).toHaveLength(1);
    });
    // 释放模块级 transitionGuard：resolve 挂起请求，让 transitionVisit 的
    // finally 执行 finish()。否则 t-1 被永久标记在途 → shuffle 顺序下后续
    // 测试（creates with cents payload、failure 报告等）的 PATCH 被守卫吞掉。
    resolveStatus?.();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('reports status transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatments?page=1&pageSize=50') {
        return { items: [{ id: 't-2', patientId: 'p-1', doctorId: 'd-1', name: '补牙', price: 10000, status: 'PLANNED' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/treatments/t-2/status') throw 'transition failed';
      return {};
    });
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    fireEvent.change(screen.getByLabelText('变更治疗状态'), { target: { value: 'IN_PROGRESS' } });
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });

  it('joins array teeth numbers when editing and falls back to ids for unnamed doctors', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatments?page=1&pageSize=50') {
        return { items: [{ id: 't-1', patientId: 'p-1', doctorId: 'd-9', name: '补牙', price: 10000, status: 'COMPLETED', teethNumbers: ['11', '21'] }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-9' }];
      return {};
    });
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('牙位（逗号分隔）') as HTMLInputElement).value).toBe('11, 21');
    });
    await waitFor(() => {
      expect((screen.getByRole('option', { name: 'd-9' }) as HTMLOptionElement).value).toBe('d-9');
    });
  });

  it('ignores an empty status transition selection', async () => {
    mockData();
    render(<TreatmentsPage />, { wrapper });
    await screen.findByText('补牙');
    const select = screen.getByLabelText('变更治疗状态') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(apiRequest).not.toHaveBeenCalledWith('/treatments/t-1/status', expect.anything());
  });
});
