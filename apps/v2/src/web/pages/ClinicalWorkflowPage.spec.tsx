// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicalWorkflowPage } from './ClinicalWorkflowPage';
import { apiRequest } from '../lib/api';
import type { Page } from '../lib/types';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function resourceData() {
  return {
    '/workbench/today': {},
    '/resources/registrations?page=1&pageSize=100': {
      items: [{ id: 'r-1', status: 'REGISTERED', patientId: 'p-1', patientIdLabel: '张三' }],
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
    fireEvent.click((await screen.findAllByRole('button', { name: '已分诊' }))[0]);
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
    fireEvent.click((await screen.findAllByRole('button', { name: '已分诊' }))[0]);
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw 'boom';
    });
    fireEvent.click(screen.getAllByRole('button', { name: '已分诊' })[0]);
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
    expect(screen.getAllByText('暂无记录').length).toBeGreaterThanOrEqual(3);
  });

  it('handles null workflow query data', async () => {
    vi.mocked(apiRequest).mockResolvedValue(null as unknown as Page<Record<string, unknown>>);
    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findAllByText('暂无记录')).toHaveLength(4);
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

  it('submits a charge from the registration row', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => resourceData()[path] ?? {});

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '划价' }))[0]);

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'GENERAL' } });
    fireEvent.change(screen.getByLabelText('单价(元)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('提交划价'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      items: [{ name: '洁牙', category: 'GENERAL', price: 10000, quantity: 2 }],
    });
    expect(await screen.findByText('划价已提交')).toBeDefined();
  });

  it('submits a medical record from the registration row', async () => {
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

  it('submits a follow-up from the registration row', async () => {
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

  it('triages a registration from the row', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [{ id: 'dep-1', name: '正畸科' }], total: 1 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      return resourceData()[path] ?? {};
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '分诊' }))[0]);

    await waitFor(() => {
      expect((screen.getByLabelText('分诊科室') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('分诊科室'), { target: { value: 'dep-1' } });
    fireEvent.change(screen.getByLabelText('分诊医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('分诊备注'), { target: { value: '牙体牙髓' } });
    fireEvent.click(screen.getByText('提交分诊'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/triage', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/registrations/r-1/triage');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({ departmentId: 'dep-1', doctorId: 'd-1', triageNote: '牙体牙髓' });
    expect(await screen.findByText('分诊已提交')).toBeDefined();
  });

  it('renders the triage queue with department filter and start visit', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [{ id: 'dep-1', name: '正畸科' }, { id: 'dep-2', name: '种植科' }], total: 2 };
      }
      if (path === '/triage/queue') {
        return {
          items: [
            {
              id: 'q-1',
              patientName: '李四',
              departmentName: '正畸科',
              doctorName: '张医生',
              status: 'REGISTERED',
              registeredAt: '2026-08-06T01:00:00.000Z',
              triagedAt: null,
            },
            {
              id: 'q-2',
              patientName: '王五',
              departmentName: '种植科',
              doctorName: '李医生',
              status: 'TRIAGED',
              registeredAt: '2026-08-06T02:00:00.000Z',
              triagedAt: '2026-08-06T02:30:00.000Z',
            },
          ],
          total: 2,
        };
      }
      if (path === '/triage/queue?departmentId=dep-1') {
        return {
          items: [
            {
              id: 'q-1',
              patientName: '李四',
              departmentName: '正畸科',
              doctorName: '张医生',
              status: 'REGISTERED',
              registeredAt: '2026-08-06T01:00:00.000Z',
              triagedAt: null,
            },
          ],
          total: 1,
        };
      }
      return resourceData()[path] ?? {};
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    expect(await screen.findByText('分诊队列')).toBeDefined();
    expect(screen.getByText('李四')).toBeDefined();
    expect(screen.getByText('王五')).toBeDefined();
    expect(screen.getAllByText('已分诊').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getAllByRole('button', { name: '开始就诊' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/q-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/registrations/q-1/status');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ status: 'IN_PROGRESS' });

    fireEvent.change(screen.getByLabelText('科室筛选'), { target: { value: 'dep-1' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/triage/queue?departmentId=dep-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('王五')).toBeNull();
    });
    expect(await screen.findByText('李四')).toBeDefined();
  });

  it('shows triage entry only for REGISTERED rows and a badge for TRIAGED rows', async () => {
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
    expect((await screen.findAllByText('已分诊')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: '分诊' })).toHaveLength(1);
    expect(document.querySelectorAll('.triage-badge')).toHaveLength(1);
  });
});
