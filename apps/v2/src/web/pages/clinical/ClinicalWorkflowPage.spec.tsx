// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicalWorkflowPage } from './ClinicalWorkflowPage';
import { apiRequest, fetchAllPages } from '../../lib/api';
import type { Page } from '../../lib/types';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), fetchAllPages: vi.fn(), downloadCsv: vi.fn() }));

vi.mocked(fetchAllPages).mockImplementation(async (path: string) => {
  const data = await vi.mocked(apiRequest)(path) as { items?: unknown[] } | unknown[];
  return Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? [];
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function resourceData() {
  return {
    '/workbench/today': {},
    '/resources/registrations?page=1&pageSize=100': {
      items: [{ id: 'r-1', status: 'TRIAGED', patientId: 'p-1', patientIdLabel: '张四' }],
      total: 1,
    },
    '/resources/visits?page=1&pageSize=100': { items: [{ id: 'v-1', status: 'IN_PROGRESS' }], total: 1 },
    '/resources/firstExams?page=1&pageSize=100': { items: [{ id: 'f-1', status: 'DRAFT' }], total: 1 },
    '/resources/treatments?page=1&pageSize=100': { items: [{ id: 't-1', status: 'PLANNED' }], total: 1 },
  } as Record<string, unknown>;
}

describe('ClinicalWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders workflow tables and transitions resources', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => resourceData()[path] ?? {});

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '进行中' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText(/已更新为/)).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '已完成' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/visits/v-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: '已提交' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    const inProgressButtons = screen.getAllByRole('button', { name: '进行中' });
    fireEvent.click(inProgressButtons[inProgressButtons.length - 1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatments/t-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw new Error('transition failed');
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '进行中' }))[0]);
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw 'boom';
    });
    fireEvent.click(screen.getAllByRole('button', { name: '进行中' })[0]);
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });

  it('shows a loading state while workflow data loads', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(screen.getAllByText('加载中...').length).toBeGreaterThanOrEqual(1);
  });

  it('shows an error when workflow data fails to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') throw new Error('workflow failed');
      return resourceData()[path] ?? {};
    });
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders fallback status text for unknown values', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return { items: [{ id: 'r-2', status: null }, { id: 'r-3', status: 'WEIRD' }], total: 2 };
      }
      return { items: [], total: 0 };
    });
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('WEIRD')).toBeDefined();
    expect(screen.getAllByText('暂无记录')).toHaveLength(3);
  });

  it('handles null workflow query data', async () => {
    vi.mocked(apiRequest).mockResolvedValue(null as unknown as Page<Record<string, unknown>>);
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findAllByText('暂无已分诊患者')).toHaveLength(1);
    expect(screen.getAllByText('暂无记录')).toHaveLength(3);
  });

  it('renders today overview totals and lists', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/workbench/today') {
        return {
          date: '2026-08-05',
          registrations: [
            {
              id: 'tr-1',
              patientId: 'p-1',
              patientName: '张三',
              doctorId: 'd-1',
              doctorName: '李医生',
              status: 'REGISTERED',
              registeredAt: '2026-08-05T01:00:00.000Z',
            },
          ],
          appointments: [
            {
              id: 'ta-1',
              patientId: 'p-2',
              patientName: '王五',
              doctorId: 'd-1',
              doctorName: '李医生',
              startTime: '2026-08-05T02:00:00.000Z',
              endTime: '2026-08-05T03:00:00.000Z',
              status: 'BOOKED',
              type: 'REGULAR',
            },
          ],
          totals: { registrations: 2, appointments: 1, inProgressVisits: 3 },
        };
      }
      return { items: [], total: 0 };
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('今日概览（2026-08-05）')).toBeDefined();
    expect(screen.getAllByText('今日挂号').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('今日预约').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('进行中就诊')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('张三')).toBeDefined();
    expect(screen.getByText('王五')).toBeDefined();
    expect(screen.getByText('已挂号')).toBeDefined();
    expect(screen.getByText('已预约')).toBeDefined();
  });

  it('renders empty today lists', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/workbench/today') {
        return {
          date: '2026-08-05',
          registrations: [],
          appointments: [],
          totals: { registrations: 0, appointments: 0, inProgressVisits: 0 },
        };
      }
      return { items: [], total: 0 };
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('今日暂无挂号')).toBeDefined();
    expect(screen.getByText('今日暂无预约')).toBeDefined();
  });

  it('submits a medical record from the triaged registration row', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      return resourceData()[path] ?? {};
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '病历' }))[0]);

    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'GENERAL' } });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '牙痛' } });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿' } });
    fireEvent.change(screen.getByLabelText('治疗计划'), { target: { value: '补牙' } });
    fireEvent.click(screen.getByText('提交病历'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/medicalRecords', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/medicalRecords');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      category: 'GENERAL',
      status: 'DRAFT',
      chiefComplaint: '牙痛',
      diagnosis: '龋齿',
      treatmentPlan: '补牙',
      isTemplate: false,
    });
    expect(await screen.findByText('病历已创建')).toBeDefined();
  });

  it('submits a follow-up from the triaged registration row', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => resourceData()[path] ?? {});

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '回访' }))[0]);

    fireEvent.change(screen.getByLabelText('随访日期'), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '术后回访' } });
    fireEvent.click(screen.getByText('提交回访'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUps', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/followUps');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      planDate: '2026-08-12',
      content: '术后回访',
      status: 'PENDING',
    });
    expect(await screen.findByText('回访已创建')).toBeDefined();
  });

  it('hides REGISTERED rows and triage actions from the doctor view', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return {
          items: [
            { id: 'r-1', status: 'REGISTERED', patientId: 'p-1', patientIdLabel: '张三' },
            { id: 'r-2', status: 'TRIAGED', patientId: 'p-2', patientIdLabel: '赵六' },
          ],
          total: 2,
        };
      }
      return resourceData()[path] ?? {};
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('赵六')).toBeDefined();
    expect(screen.queryByText('张三')).toBeNull();
    expect(screen.queryByRole('button', { name: '分诊' })).toBeNull();
    expect(screen.queryByRole('button', { name: '划价' })).toBeNull();
    expect(document.querySelectorAll('.triage-badge')).toHaveLength(1);
  });

  it('renders sparse workflow rows with blank statuses', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      const map: Record<string, unknown> = {
        '/workbench/today': {},
        '/resources/registrations?page=1&pageSize=100': {
          items: [{ id: 'r-9', status: null, patientId: null, patientIdLabel: null }],
          total: 1,
        },
        '/resources/visits?page=1&pageSize=100': { items: [{ id: 'v-9', status: null }], total: 1 },
        '/resources/firstExams?page=1&pageSize=100': { items: [{ id: 'f-9', status: null }], total: 1 },
        '/resources/treatments?page=1&pageSize=100': { items: [{ id: 't-9', status: null }], total: 1 },
      };
      return map[path] ?? {};
    });
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('候诊')).toBeDefined();
    expect(screen.getByText('就诊工作台')).toBeDefined();
    expect(await screen.findByRole('button', { name: '病历' })).toBeDefined();
  });

  it('pages the registration board server-side', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return {
          items: [{ id: 'r-1', status: 'TRIAGED', patientId: 'p-1', patientIdLabel: '张四' }],
          total: 150,
          page: 1,
          pageSize: 100,
        };
      }
      if (path === '/resources/registrations?page=2&pageSize=100') {
        return {
          items: [{ id: 'r-2', status: 'TRIAGED', patientId: 'p-2', patientIdLabel: '李五' }],
          total: 150,
          page: 2,
          pageSize: 100,
        };
      }
      return { items: [], total: 0, page: 1, pageSize: 100 };
    });
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('张四')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '下一页' })[0]);
    expect(await screen.findByText('李五')).toBeDefined();
    expect(screen.getByText('第 2 页')).toBeDefined();
  });
});
