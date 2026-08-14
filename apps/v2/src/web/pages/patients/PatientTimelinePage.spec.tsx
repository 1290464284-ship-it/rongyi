// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router';
import { PatientTimelinePage } from './PatientTimelinePage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock('../../lib/api', () => ({
  apiRequest: mockApiRequest,
  fetchAllPages: vi.fn(async (path: string) => {
    const page = await mockApiRequest(path);
    return Array.isArray(page) ? page : ((page as { items?: unknown[] })?.items ?? []);
  }),
  downloadCsv: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  </MemoryRouter>
);

describe('PatientTimelinePage', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('merges visits, treatments, charges, and follow-ups into one timeline', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        items: [{ id: 'patient-demo-001', name: 'Demo Patient' }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'COMPLETED' }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 't1', completedDate: '2026-08-05', name: 'Treatment B', status: 'COMPLETED' }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'c1', paidAt: '2026-08-06', number: 'CHG-1', status: 'PAID', totalAmount: 100 }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'f1', planDate: '2026-08-07', content: 'Follow C', status: 'PENDING' }],
        total: 1,
        page: 1,
        pageSize: 200,
      });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('Visit A', {}, { timeout: 5000 })).toBeDefined();
    expect(screen.getByText('Treatment B')).toBeDefined();
    expect(screen.getByText('CHG-1')).toBeDefined();
    expect(screen.getByText('Follow C')).toBeDefined();
    expect(screen.getByText('Demo Patient')).toBeDefined();
    // C2：收费金额以「分」存储，渲染为元字符串（100 分 → ¥1.00）
    expect(screen.getByText('收费 · PAID · ¥1.00')).toBeDefined();
  });

  it('renders fallback labels for incomplete timeline rows', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ items: [{ id: 'patient-demo-001', name: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 'v1', startTime: null, summary: null, status: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 't1', completedDate: null, code: null, status: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 'c1', paidAt: null, number: null, status: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 'f1', planDate: null, content: null, status: null }], total: 1, page: 1, pageSize: 200 });

    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('就诊记录')).toBeDefined();
    expect(screen.getByText('治疗记录')).toBeDefined();
    expect(screen.getByText('收费记录')).toBeDefined();
    expect(screen.getByText('随访记录')).toBeDefined();
  });

  it('renders an empty timeline', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('暂无时间线记录')).toBeDefined();
  });

  it('switches patient and reloads timeline queries', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('patientId=')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return {
        items: [
          { id: 'patient-demo-001', name: 'Patient A' },
          { id: 'patient-demo-002', name: 'Patient B' },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      };
    });

    render(<PatientTimelinePage />, { wrapper });
    await screen.findByText('Patient A');
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    // 注意：patientId 变化时页面会经 LoadingState 早退而卸载/重挂 SearchableSelect，
    // options 需重新异步加载；若在重挂后的空 select 上 change，原生 value setter 会
    // 静默失败。因此在轮询内完成 change + 断言，直到成功。
    await waitFor(() => {
      const combo = screen.getByRole('combobox') as HTMLSelectElement;
      if (!Array.from(combo.options).some((option) => option.value === 'patient-demo-002')) {
        throw new Error('patient-demo-002 option not loaded yet');
      }
      fireEvent.change(combo, { target: { value: 'patient-demo-002' } });
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=patient-demo-002'));
    });
  });

  it('uses the first real patient id from the list for the dependent timeline queries', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('patientId=')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return { items: [{ id: 'p-real-1', name: 'Real Patient' }], total: 1, page: 1, pageSize: 200 };
    });

    render(<PatientTimelinePage />, { wrapper });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=p-real-1'));
    });
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('patientId=patient-demo-001'));
  });

  it('prefers the URL id parameter when initializing the patient', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('patientId=')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return { items: [{ id: 'p-list-1', name: 'List Patient' }], total: 1, page: 1, pageSize: 200 };
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/timeline', search: '?id=url-patient-7' }]}>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <PatientTimelinePage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=url-patient-7'));
    });
  });

  it('degrades a failed timeline block without hiding other blocks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) throw new Error('visits failed');
      if (path.includes('/resources/treatments?')) {
        return { items: [{ id: 't1', completedDate: '2026-08-05', name: 'Treatment OK', status: 'COMPLETED' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path.includes('/custom-fields')) return [];
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><PatientTimelinePage /></ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Treatment OK')).toBeDefined();
    expect(await screen.findByText('该区块加载失败')).toBeDefined();
  });

  it('retries a failed timeline block', async () => {
    let fail = true;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) {
        if (fail) throw new Error('visits failed');
        return { items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit OK', status: 'COMPLETED' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path.includes('/resources/treatments?') || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      if (path.includes('/custom-fields')) return [];
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('该区块加载失败')).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('Visit OK')).toBeDefined();
    expect(screen.queryByText('该区块加载失败')).toBeNull();
  });

  it('saves custom field values', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/resources/visits?') || path.includes('/resources/treatments?')
        || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/custom-fields?entity=patient') {
        return [{ id: 'cf-1', label: '过敏史', fieldName: 'allergy', fieldType: 'TEXT' }];
      }
      if (path.includes('/custom-fields/values?entity=patient&entityId=')) return { values: {} };
      if (path === '/custom-fields/values' && options?.method === 'PUT') return {};
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });

    render(<PatientTimelinePage />, { wrapper });
    const input = await screen.findByLabelText(/过敏史/);
    fireEvent.change(input, { target: { value: '青霉素' } });
    fireEvent.click(screen.getByText('保存自定义信息'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/custom-fields/values', expect.objectContaining({ method: 'PUT' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/custom-fields/values' && (options as RequestInit)?.method === 'PUT',
    );
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body)) as { values: Array<{ fieldId: string; value: string }> };
    expect(body.values).toEqual([{ fieldId: 'cf-1', value: '青霉素' }]);
    expect(await screen.findByText('自定义信息已保存')).toBeDefined();
  });

  it('shows the timeline loading state', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?') || path.includes('/resources/treatments?')
        || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return new Promise(() => {});
      }
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('时间线加载中...')).toBeDefined();
  });

  it('reports custom field save failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/resources/visits?') || path.includes('/resources/treatments?')
        || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/custom-fields?entity=patient') {
        return [{ id: 'cf-1', label: '过敏史', fieldName: 'allergy', fieldType: 'TEXT' }];
      }
      if (path.includes('/custom-fields/values?entity=patient&entityId=')) return { values: {} };
      if (path === '/custom-fields/values' && options?.method === 'PUT') throw new Error('save failed');
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });

    const input = await screen.findByLabelText(/过敏史/);
    fireEvent.change(input, { target: { value: '青霉素' } });
    fireEvent.click(screen.getByText('保存自定义信息'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders BOOLEAN custom fields as checkboxes with saved values', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?') || path.includes('/resources/treatments?')
        || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/custom-fields?entity=patient') {
        return [{ id: 'cf-flag', label: '是否吸烟', fieldName: 'smoker', fieldType: 'BOOLEAN' }];
      }
      if (path.includes('/custom-fields/values?entity=patient&entityId=')) {
        return { values: { 'cf-flag': '1' } };
      }
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });

    const checkbox = await screen.findByRole('checkbox', { name: /是否吸烟/ });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('renders SELECT and NUMBER custom fields and saves their values', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/resources/visits?') || path.includes('/resources/treatments?')
        || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/custom-fields?entity=patient') {
        return [
          { id: 'cf-sel', label: '来源', fieldName: 'source', fieldType: 'SELECT', optionsJson: '["线上","到店"]' },
          { id: 'cf-num', label: '年龄', fieldName: 'age', fieldType: 'NUMBER' },
        ];
      }
      if (path.includes('/custom-fields/values?entity=patient&entityId=')) {
        return { values: { 'cf-sel': '到店', 'cf-num': '30' } };
      }
      if (path === '/custom-fields/values' && options?.method === 'PUT') return {};
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });

    const select = await screen.findByLabelText(/来源/);
    expect((select as HTMLSelectElement).value).toBe('到店');
    fireEvent.change(select, { target: { value: '线上' } });
    const number = screen.getByLabelText(/年龄/) as HTMLInputElement;
    expect(number.value).toBe('30');
    fireEvent.change(number, { target: { value: '31' } });
    fireEvent.click(screen.getByText('保存自定义信息'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/custom-fields/values', expect.objectContaining({ method: 'PUT' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/custom-fields/values' && (options as RequestInit)?.method === 'PUT',
    );
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body)) as { values: Array<{ fieldId: string; value: string }> };
    expect(body.values).toEqual([
      { fieldId: 'cf-sel', value: '线上' },
      { fieldId: 'cf-num', value: '31' },
    ]);
  });

  it('renders current tones, tie-broken sorting, null amounts and required labels', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) {
        return {
          items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'IN_PROGRESS' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.includes('/resources/treatments?')) return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path.includes('/resources/charges?')) {
        return {
          items: [
            { id: 'c1', paidAt: '2026-08-04T09:00:00.000Z', number: 'CHG-1', status: 'PAID', totalAmount: 100 },
            { id: 'c2', paidAt: '2026-08-04T09:00:00.000Z', number: 'CHG-2', status: 'PAID', totalAmount: null },
          ],
          total: 2,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.includes('/resources/followUps?')) return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/custom-fields?entity=patient') {
        return [{ id: 'cf-1', label: '过敏史', fieldName: 'allergy', fieldType: 'TEXT', required: true }];
      }
      if (path.includes('/custom-fields/values?entity=patient&entityId=')) return { values: {} };
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });

    expect(await screen.findByText('Visit A')).toBeDefined();
    expect(screen.getByText('就诊 · IN_PROGRESS')).toBeDefined();
    expect(screen.getByText('CHG-1')).toBeDefined();
    expect(screen.getByText('CHG-2')).toBeDefined();
    expect(screen.getByText('收费 · PAID · ¥1.00')).toBeDefined();
    expect(screen.getByText('收费 · PAID')).toBeDefined();
    const label = (await screen.findByLabelText(/过敏史/)).closest('label') as HTMLElement;
    expect(label.textContent).toContain('*');
  });

  it('renders non-Error timeline failures and null custom field values', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) throw 'visits boom';
      if (path.includes('/resources/treatments?') || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/custom-fields?entity=patient') {
        return [
          { id: 'cf-sel', label: '来源', fieldName: 'source', fieldType: 'SELECT', optionsJson: '["线上","到店"]' },
          { id: 'cf-num', label: '年龄', fieldName: 'age', fieldType: 'NUMBER' },
        ];
      }
      if (path.includes('/custom-fields/values?entity=patient&entityId=')) {
        return { values: { 'cf-sel': null, 'cf-num': null } };
      }
      if (path === '/custom-fields?entity=patient') return [];
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><PatientTimelinePage /></ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    const select = await screen.findByLabelText(/来源/);
    expect((select as HTMLSelectElement).value).toBe('');
    fireEvent.change(select, { target: { value: '线上' } });
    expect((screen.getByLabelText(/年龄/) as HTMLInputElement).value).toBe('');
  });

  it('loads more timeline rows from the next server page', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) {
        return path.includes('page=2')
          ? { items: [{ id: 'v2', startTime: '2026-08-03T09:00:00.000Z', summary: 'Visit B', status: 'COMPLETED' }], total: 150, page: 2, pageSize: 50 }
          : { items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'COMPLETED' }], total: 150, page: 1, pageSize: 50 };
      }
      if (path.includes('/resources/treatments?') || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('Visit A')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('Visit B')).toBeDefined();
  });

  it('clears the previous patient timeline when the patient is cleared', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) {
        return { items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'COMPLETED' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path.includes('/resources/treatments?') || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('Visit A')).toBeDefined();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    await waitFor(() => {
      expect(screen.queryByText('Visit A')).toBeNull();
    });
  });

  it('reports load-more failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('page=2')) throw new Error('load failed');
      if (path.includes('/resources/visits?')) {
        return { items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'COMPLETED' }], total: 150, page: 1, pageSize: 50 };
      }
      if (path.includes('/resources/treatments?') || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('Visit A')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('queries timeline resources with an empty URL patient id', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/')) {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      return { items: [], total: 0, page: 1, pageSize: 200 };
    });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/timeline', search: '?id=' }]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <PatientTimelinePage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无时间线记录')).toBeDefined();
    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=&page=1'));
    expect(apiRequest).toHaveBeenCalledWith('/custom-fields/values?entity=patient&entityId=');
  });

  it('shows the loading label while fetching the next timeline page', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('page=2')) return new Promise(() => {});
      if (path.includes('/resources/visits?')) {
        return { items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'COMPLETED' }], total: 150, page: 1, pageSize: 50 };
      }
      if (path.includes('/resources/treatments?') || path.includes('/resources/charges?') || path.includes('/resources/followUps?')) {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    await screen.findByText('Visit A');
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('加载中...')).toBeDefined();
  });

  it('resets the patient when the URL id changes', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('patientId=')) return { items: [], total: 0, page: 1, pageSize: 200 };
      return { items: [{ id: 'p-list-1', name: 'List Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    function NavigateButton() {
      const navigate = useNavigate();
      return <button onClick={() => navigate({ pathname: '/timeline', search: '?id=second-patient' })}>navigate</button>;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/timeline', search: '?id=first-patient' }]}>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <PatientTimelinePage />
            <NavigateButton />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=first-patient'));
    });
    fireEvent.click(screen.getByText('navigate'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=second-patient'));
    });
  });

  it('drops in-flight timeline pages from the previous patient', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('patientId=p-old')) {
        return await new Promise((resolve) => { resolveOld = resolve; });
      }
      if (path.includes('patientId=')) return { items: [], total: 0, page: 1, pageSize: 200 };
      return {
        items: [{ id: 'p-old', name: 'Old Patient' }, { id: 'p-new', name: 'New Patient' }],
        total: 2,
        page: 1,
        pageSize: 200,
      };
    });
    render(<PatientTimelinePage />, { wrapper });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=p-old'));
    });
    await waitFor(() => {
      const combo = screen.getByRole('combobox') as HTMLSelectElement;
      if (!Array.from(combo.options).some((option) => option.value === 'p-new')) {
        throw new Error('p-new option missing');
      }
      fireEvent.change(combo, { target: { value: 'p-new' } });
    });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=p-new'));
    });
    // 旧患者的挂起响应返回：generation 守卫将其丢弃为空页
    resolveOld?.({ items: [{ id: 'stale-row', summary: 'Stale Visit' }], total: 1, page: 1, pageSize: 50 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Stale Visit')).toBeNull();
  });

  it('caps the rendered timeline and shows the overflow reminder', async () => {
    const bigItems = Array.from({ length: 501 }, (_, index) => ({
      id: `v-${index}`,
      startTime: `2026-08-0${(index % 9) + 1}T10:00:00.000Z`,
      summary: `Visit ${index}`,
      status: 'COMPLETED',
    }));
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/resources/visits?')) {
        return { items: bigItems, total: 501, page: 1, pageSize: 50 };
      }
      if (path.includes('patientId=')) return { items: [], total: 0, page: 1, pageSize: 50 };
      return { items: [{ id: 'p-real-1', name: 'Real Patient' }], total: 1, page: 1, pageSize: 200 };
    });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText(/时间线超过 500 条，仅显示最近 500 条/)).toBeDefined();
  });
});
