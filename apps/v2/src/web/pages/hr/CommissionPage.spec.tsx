// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommissionPage } from './CommissionPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const rules = [
  {
    id: 'rule-1',
    name: '服务 10%',
    category: 'TREATMENT',
    costType: 'SERVICE',
    rateType: 'PERCENT',
    rate: 1000,
    doctorId: null,
    enabled: 1,
  },
  {
    id: 'rule-2',
    name: '固定 200',
    category: null,
    costType: null,
    rateType: 'FIXED',
    rate: 20000,
    doctorId: 'user-doctor-001',
    enabled: 1,
  },
];

const statements = [
  {
    id: 'stmt-1',
    period: '2026-08',
    doctorId: 'user-doctor-001',
    doctorName: '张医生',
    totalCharged: 100000,
    totalCommission: 10000,
    breakdown: [{ category: 'TREATMENT', costType: 'SERVICE', charged: 100000, commission: 10000 }],
    calculatedAt: '2026-08-10T10:00:00.000Z',
  },
];

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (path === '/commission/rules' && method === 'GET') return rules;
    if (path === '/commission/rules' && method === 'POST') return { id: 'rule-new' };
    if (path === '/commission/rules/rule-1' && method === 'PATCH') return { id: 'rule-1' };
    if (path === '/commission/rules/rule-1' && method === 'DELETE') return { id: 'rule-1' };
    if (path === '/commission/calculate' && method === 'POST') return statements;
    if (path.startsWith('/commission/statements?')) return statements;
    if (path === '/doctors') return [{ id: 'user-doctor-001', name: '张医生' }];
    if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') {
      return { items: [{ id: 'cat-1', name: 'TREATMENT' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('CommissionPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders rules with rate labels and statement rows', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    expect(await screen.findByText('服务 10%')).toBeDefined();
    expect(screen.getByText('10%')).toBeDefined();
    expect(screen.getByText('全部分类 / 指定医生')).toBeDefined();
    expect(await screen.findAllByText('张医生').then((items) => items.length)).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('¥100.00')).toBeDefined();
  });

  it('creates a rule with the expected payload', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');

    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '种植服务 5%' } });
    fireEvent.change(screen.getByLabelText('规则分类'), { target: { value: 'TREATMENT' } });
    fireEvent.change(screen.getByLabelText('提成方式'), { target: { value: 'PERCENT' } });
    fireEvent.change(screen.getByLabelText('提成值'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/rules', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/commission/rules' && init?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      name: '种植服务 5%',
      category: 'TREATMENT',
      costType: null,
      rateType: 'PERCENT',
      rate: 500,
      doctorId: null,
      enabled: true,
    });
    expect(await screen.findByText('提成规则已创建')).toBeDefined();
  });

  it('rejects invalid rates and edits an existing rule', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');

    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '坏规则' } });
    fireEvent.change(screen.getByLabelText('提成方式'), { target: { value: 'PERCENT' } });
    fireEvent.change(screen.getByLabelText('提成值'), { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    expect(await screen.findByText('提成比例不能超过 100%')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    expect((screen.getByLabelText('规则名称') as HTMLInputElement).value).toBe('服务 10%');
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '服务 12%' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/rules/rule-1', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('提成规则已更新')).toBeDefined();
  });

  it('round-trips fixed-rate rules between yuan input and cent storage', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');

    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '固定 5 元' } });
    fireEvent.change(screen.getByLabelText('提成方式'), { target: { value: 'FIXED' } });
    fireEvent.change(screen.getByLabelText('提成值'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/rules', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/commission/rules' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ rateType: 'FIXED', rate: 500 });

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1]);
    expect((screen.getByLabelText('提成值') as HTMLInputElement).value).toBe('200.00');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/rules/rule-2', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/commission/rules/rule-2' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({ rateType: 'FIXED', rate: 20000 });
  });

  it('calculates commissions for the selected month', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getByRole('button', { name: '计算本月提成' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/calculate', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/commission/calculate');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ period: expect.stringMatching(/^\d{4}-\d{2}$/) });
    expect(await screen.findByText('提成计算完成')).toBeDefined();
  });

  it('deletes a rule after confirmation', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '删除') as HTMLButtonElement);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/rules/rule-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('提成规则已删除')).toBeDefined();
  });

  it('shows loading and error states for rules and statements', async () => {
    let resolveRules!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') {
        return new Promise((resolve) => {
          resolveRules = resolve;
        });
      }
      if (path.startsWith('/commission/statements?')) return [];
      if (path === '/doctors') return [];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') return { items: [] };
      return {};
    });
    render(<CommissionPage />, { wrapper });
    expect(screen.getByText('加载规则…')).toBeDefined();
    resolveRules(Promise.reject(new Error('Load failed')));
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') return [];
      if (path.startsWith('/commission/statements?')) throw new Error('Load failed');
      if (path === '/doctors') return [];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') return { items: [] };
      return {};
    });
    render(<CommissionPage />, { wrapper });
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
  });

  it('validates the rule name and rate', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');

    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    expect(await screen.findByText('请填写规则名称和非负整数提成值')).toBeDefined();

    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '坏规则' } });
    fireEvent.change(screen.getByLabelText('提成值'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    expect(await screen.findByText('请填写规则名称和非负整数提成值')).toBeDefined();
  });

  it('reports save failures', async () => {
    mockApi();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/commission/rules' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '新规则' } });
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    expect(await screen.findByText('保存提成规则失败')).toBeDefined();
  });

  it('reports delete failures', async () => {
    mockApi();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/commission/rules/rule-1' && String(init?.method ?? 'GET').toUpperCase() === 'DELETE') throw new Error('');
      return base?.(path, init);
    });
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '删除') as HTMLButtonElement);
    expect(await screen.findByText('删除提成规则失败')).toBeDefined();
  });

  it('reports calculation failures', async () => {
    mockApi();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/commission/calculate' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getByRole('button', { name: '计算本月提成' }));
    expect(await screen.findByText('提成计算失败')).toBeDefined();
  });

  it('renders fixed rates and material scope', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') {
        return [
          { id: 'r3', name: '材料固定', category: null, costType: 'MATERIAL', rateType: 'FIXED', rate: 20000, doctorId: null, enabled: 1 },
        ];
      }
      if (path.startsWith('/commission/statements?')) return [];
      if (path === '/doctors') return [];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') return { items: [] };
      return {};
    });
    render(<CommissionPage />, { wrapper });
    expect(await screen.findByText('全部分类 / 材料耗材 / 默认')).toBeDefined();
    expect(screen.getByText('¥200.00/单')).toBeDefined();
  });

  it('cancels editing back to the create form', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(screen.getByRole('button', { name: '新增规则' })).toBeDefined();
  });

  it('changes cost type, doctor scope, enabled state and calculation month', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');

    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '材料固定规则' } });
    fireEvent.change(screen.getByLabelText('规则分类'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('成本类型'), { target: { value: 'MATERIAL' } });
    fireEvent.change(screen.getByLabelText('提成方式'), { target: { value: 'FIXED' } });
    fireEvent.change(screen.getByLabelText('提成值'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('适用医生'), { target: { value: 'user-doctor-001' } });
    fireEvent.click(screen.getByLabelText('启用规则'));
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/rules', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/commission/rules' && init?.method === 'POST',
    );
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      costType: 'MATERIAL',
      rateType: 'FIXED',
      rate: 20000,
      doctorId: 'user-doctor-001',
      enabled: false,
    });

    fireEvent.change(screen.getByLabelText('计算月份'), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: '计算本月提成' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/commission/calculate', expect.objectContaining({ method: 'POST' }));
    });
    const calcCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/commission/calculate');
    expect(JSON.parse(String(calcCall?.[1]?.body))).toEqual({ period: '2026-07' });
  });

  it('ignores a duplicate rule submit while busy', async () => {
    mockApi();
    let resolvePost: ((value: unknown) => void) | undefined;
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/commission/rules' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolvePost = resolve; });
      }
      return base?.(path, init);
    });
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '新规则' } });
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const postCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/commission/rules' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    resolvePost?.({ id: 'rule-new' });
    expect(await screen.findByText('提成规则已创建')).toBeDefined();
  });

  it('cancels rule deletion through the confirm dialog', async () => {
    mockApi();
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '取消') as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/commission/rules/rule-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('renders sparse rules and statements with fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') {
        return [{ id: 'r9', name: null, category: null, costType: null, rateType: 'FIXED', rate: null, doctorId: null, enabled: 0 }];
      }
      if (path.startsWith('/commission/statements?')) {
        return [{ id: 's9', period: '2026-08', doctorId: 'd-9', doctorName: null, totalCharged: null, totalCommission: null, breakdown: [], calculatedAt: null }];
      }
      if (path === '/doctors') return [{ id: 'd-9' }];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') {
        return { items: [{ id: 'cat-1', name: null }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<CommissionPage />, { wrapper });
    expect(await screen.findByText('全部分类 / 默认')).toBeDefined();
    expect(screen.getByText('/单')).toBeDefined();
    expect(screen.getByText('停用')).toBeDefined();
    expect((await screen.findAllByText('d-9')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('—')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('规则名称') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('分类') as HTMLSelectElement).textContent).toContain('cat-1');
    expect((screen.getByLabelText('适用医生') as HTMLSelectElement).textContent).toContain('d-9');
  });

  it('renders zero percent fallbacks for sparse percent rules', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') {
        return [{ id: 'rule-null', name: '空比例', category: null, costType: null, rateType: 'PERCENT', rate: null, doctorId: null, enabled: 1 }];
      }
      if (path.startsWith('/commission/statements?')) return [];
      if (path === '/doctors') return [];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<CommissionPage />, { wrapper });
    expect(await screen.findByText('空比例')).toBeDefined();
    expect(screen.getByText('0%')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('提成值') as HTMLInputElement).value).toBe('0');
    });
  });

  it('renders empty doctor names for statements missing both name and id', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') return [];
      if (path.startsWith('/commission/statements?')) {
        return [{
          id: 'stmt-null',
          period: '2026-08',
          doctorId: null,
          doctorName: null,
          totalCharged: 0,
          totalCommission: 0,
          breakdown: [],
          calculatedAt: '2026-08-10T10:00:00.000Z',
        }];
      }
      if (path === '/doctors') return [];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<CommissionPage />, { wrapper });
    expect(await screen.findByText('—')).toBeDefined();
  });

  it('treats undefined rule and statement data as errored queries', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/commission/rules') return undefined;
      if (path.startsWith('/commission/statements?')) return undefined;
      if (path === '/doctors') return [];
      if (path === '/resources/treatmentCatalogs?page=1&pageSize=200') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<CommissionPage />, { wrapper });
    // TanStack Query v5 将 data 为 undefined 的查询标记为 error，页面落入错误态而非空表。
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThanOrEqual(2);
  });

  it('ignores a duplicate delete confirm while the delete is in flight', async () => {
    mockApi();
    let deleteCalls = 0;
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/commission/rules/rule-1' && String(init?.method ?? 'GET').toUpperCase() === 'DELETE') {
        deleteCalls += 1;
        return new Promise(() => {});
      }
      return base?.(path, init);
    });
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    const dialog = await screen.findByRole('dialog');
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '删除') as HTMLButtonElement;
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(deleteCalls).toBe(1);
    });
  });

  it('ignores a duplicate calculate while the calculation is in flight', async () => {
    mockApi();
    let calculateCalls = 0;
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/commission/calculate' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        calculateCalls += 1;
        return new Promise(() => {});
      }
      return base?.(path, init);
    });
    render(<CommissionPage />, { wrapper });
    await screen.findByText('服务 10%');
    const button = screen.getByRole('button', { name: '计算本月提成' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(calculateCalls).toBe(1);
    });
  });
});
