// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { ChargeDialog } from './ChargeDialog';
import { CreateFollowUpDialog } from './CreateFollowUpDialog';
import { RecordDialog } from './RecordDialog';
import { RegistrationBoard } from './RegistrationBoard';
import { TodayOverview } from './TodayOverview';
import { TriageDialog } from './TriageDialog';
import { TriageQueuePanel } from './TriageQueuePanel';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import { STATUS_LABELS } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const row = { id: 'r-1', patientId: 'p-1', patientName: '张三' };

function mockLookups() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }, { id: 'd-2' }];
    if (path === '/resources/departments?page=1&pageSize=100') {
      return { items: [{ id: 'dept-1', name: '口腔内科' }], total: 1, page: 1, pageSize: 100 };
    }
    if (method === 'POST' && path === '/charges') return { id: 'c-1' };
    if (method === 'POST' && path === '/resources/medicalRecords') return { id: 'mr-1' };
    if (method === 'POST' && path === '/resources/followUps') return { id: 'fu-1' };
    if (method === 'POST' && path === '/registrations/r-1/triage') return { id: 'tr-1' };
    return {};
  });
}

function fakeQuery<T>(overrides: Partial<UseQueryResult<T, Error>> = {}) {
  return {
    isLoading: false,
    error: null,
    data: undefined,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as UseQueryResult<T, Error>;
}

describe('ChargeDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('validates items and submits a valid charge', async () => {
    mockLookups();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<ChargeDialog row={row} onClose={onClose} onSaved={onSaved} />, { wrapper });
    expect((screen.getByLabelText('患者') as HTMLInputElement).value).toBe('张三');

    fireEvent.click(screen.getByRole('button', { name: '提交划价' }));
    expect(await screen.findByText('请至少填写一条有效收费明细')).toBeDefined();

    const nameInputs = screen.getAllByLabelText('项目名称');
    const categoryInputs = screen.getAllByLabelText('分类');
    const priceInputs = screen.getAllByLabelText('单价(元)');
    const quantityInputs = screen.getAllByLabelText('数量');
    fireEvent.change(nameInputs[0], { target: { value: '洁牙' } });
    fireEvent.change(categoryInputs[0], { target: { value: 'CLEAN' } });
    fireEvent.change(priceInputs[0], { target: { value: '100' } });
    fireEvent.change(quantityInputs[0], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '提交划价' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/charges');
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({
      patientId: 'p-1',
      items: [{ name: '洁牙', category: 'CLEAN', price: 10000, quantity: 2 }],
    });
    expect(await screen.findByText('划价已提交')).toBeDefined();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('adds and removes items and reports failures', async () => {
    mockLookups();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST' && path === '/charges') throw new Error('');
      return base?.(path, init);
    });
    render(<ChargeDialog row={row} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper });
    expect((screen.getByRole('button', { name: '删除' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('项目名称')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(screen.getAllByLabelText('项目名称')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价(元)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '提交划价' }));
    expect(await screen.findByText('提交划价失败')).toBeDefined();
  });

  it('blocks submission when a filled row has invalid price or quantity', async () => {
    mockLookups();
    const onSaved = vi.fn();
    render(<ChargeDialog row={row} onClose={vi.fn()} onSaved={onSaved} />, { wrapper });

    fireEvent.change(screen.getAllByLabelText('项目名称')[0], { target: { value: '洁牙' } });
    fireEvent.change(screen.getAllByLabelText('单价(元)')[0], { target: { value: '100' } });
    fireEvent.change(screen.getAllByLabelText('数量')[0], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));

    fireEvent.change(screen.getAllByLabelText('项目名称')[1], { target: { value: '无效项' } });
    fireEvent.change(screen.getAllByLabelText('单价(元)')[1], { target: { value: '0' } });
    fireEvent.change(screen.getAllByLabelText('数量')[1], { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '提交划价' }));

    expect(await screen.findByText('存在无效收费明细，请检查数量与单价')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('requires a patient before submitting a charge', async () => {
    mockLookups();
    render(<ChargeDialog row={{ id: 'r-1', patientName: '临时患者' }} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '提交划价' }));
    expect(await screen.findByText('请至少填写一条有效收费明细')).toBeDefined();
  });
});

describe('RecordDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('requires a doctor and submits a medical record', async () => {
    mockLookups();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<RecordDialog row={row} onClose={onClose} onSaved={onSaved} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: '提交病历' }));
    expect(await screen.findByText('请选择医生')).toBeDefined();

    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('d-1');
    });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '初诊' } });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '牙痛' } });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿' } });
    fireEvent.change(screen.getByLabelText('治疗计划'), { target: { value: '充填' } });
    fireEvent.click(screen.getByRole('button', { name: '提交病历' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/medicalRecords', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/resources/medicalRecords');
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      category: '初诊',
      status: 'DRAFT',
      chiefComplaint: '牙痛',
      diagnosis: '龋齿',
      treatmentPlan: '充填',
      isTemplate: false,
    });
    expect(await screen.findByText('病历已创建')).toBeDefined();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('reports creation failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST' && path === '/resources/medicalRecords') throw new Error('');
      return {};
    });
    render(<RecordDialog row={row} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('d-1');
    });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.click(screen.getByRole('button', { name: '提交病历' }));
    expect(await screen.findByText('创建病历失败')).toBeDefined();
  });
});

describe('CreateFollowUpDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('requires a date and submits a follow-up', async () => {
    mockLookups();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<CreateFollowUpDialog row={row} onClose={onClose} onSaved={onSaved} />, { wrapper });
    fireEvent.change(screen.getByLabelText('随访日期'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回访' }));
    expect(await screen.findByText('请选择随访日期')).toBeDefined();

    fireEvent.change(screen.getByLabelText('随访日期'), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '一周后复查' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回访' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUps', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/resources/followUps');
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({
      patientId: 'p-1',
      planDate: '2026-08-20',
      content: '一周后复查',
      status: 'PENDING',
    });
    expect(await screen.findByText('回访已创建')).toBeDefined();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('reports creation failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST' && path === '/resources/followUps') throw new Error('');
      return {};
    });
    render(<CreateFollowUpDialog row={row} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '提交回访' }));
    expect(await screen.findByText('创建回访失败')).toBeDefined();
  });
});

describe('TriageDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('submits triage choices and reports failures', async () => {
    mockLookups();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<TriageDialog row={row} onClose={onClose} onSaved={onSaved} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByRole('option', { name: '口腔内科' }) as HTMLOptionElement).value).toBe('dept-1');
    });
    fireEvent.change(screen.getByLabelText('分诊科室'), { target: { value: 'dept-1' } });
    fireEvent.change(screen.getByLabelText('分诊医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('分诊备注'), { target: { value: '牙痛' } });
    fireEvent.click(screen.getByRole('button', { name: '提交分诊' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/triage', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/registrations/r-1/triage');
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({
      departmentId: 'dept-1',
      doctorId: 'd-1',
      triageNote: '牙痛',
    });
    expect(await screen.findByText('分诊已提交')).toBeDefined();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();

    cleanup();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST' && path === '/registrations/r-1/triage') throw new Error('');
      return base?.(path, init);
    });
    render(<TriageDialog row={row} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '提交分诊' }));
    expect(await screen.findByText('提交分诊失败')).toBeDefined();
  });
});

describe('RegistrationBoard', () => {
  afterEach(() => {
    cleanup();
  });

  const rows = [
    { id: 'r1', patientIdLabel: '张三', status: 'REGISTERED' },
    { id: 'r2', patientIdLabel: '李四', status: 'IN_PROGRESS' },
    { id: 'r3', patientIdLabel: '王五', status: 'COMPLETED' },
    { id: 'r4', patientIdLabel: '赵六', status: 'CANCELLED' },
  ];

  it('renders loading, error, empty and filtered states', () => {
    const { rerender } = render(
      <RegistrationBoard
        query={fakeQuery({ isLoading: true })}
        renderActions={() => <button>操作</button>}
        onBoardChange={vi.fn()}
      />,
    );
    expect(screen.getByText('加载中...')).toBeDefined();

    rerender(
      <RegistrationBoard
        query={fakeQuery({ error: new Error('Load failed') })}
        renderActions={() => <button>操作</button>}
        onBoardChange={vi.fn()}
      />,
    );
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();

    rerender(
      <RegistrationBoard
        query={fakeQuery({ data: { items: rows, total: 4, page: 1, pageSize: 50 } })}
        renderActions={() => <button>操作</button>}
        onBoardChange={vi.fn()}
        filterRows={(entry) => entry.id !== 'r3'}
        emptyText="没有记录"
      />,
    );
    expect(screen.getByText('候诊')).toBeDefined();
    expect(screen.getByText('就诊中')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();
    expect(screen.getByText(STATUS_LABELS.REGISTERED ?? 'REGISTERED')).toBeDefined();
    expect(screen.queryByText('王五')).toBeNull();
  });

  it('reports board moves with the target status', () => {
    const onBoardChange = vi.fn();
    render(
      <RegistrationBoard
        query={fakeQuery({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 50 } })}
        renderActions={() => <button>操作</button>}
        onBoardChange={onBoardChange}
      />,
    );
    const dataTransfer = { setData: vi.fn(), getData: () => 'r1' };
    fireEvent.dragStart(screen.getByText('张三'), { dataTransfer });
    fireEvent.drop(screen.getByText('就诊中'), { dataTransfer });
    expect(onBoardChange).toHaveBeenCalledWith('r1', 'IN_PROGRESS');
  });

  it('maps board moves to completed and registered statuses', () => {
    const onBoardChange = vi.fn();
    render(
      <RegistrationBoard
        query={fakeQuery({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 50 } })}
        renderActions={() => <button>操作</button>}
        onBoardChange={onBoardChange}
      />,
    );
    const dataTransfer = { setData: vi.fn(), getData: () => 'r1' };
    fireEvent.dragStart(screen.getByText('张三'), { dataTransfer });
    fireEvent.drop(screen.getByText('已完成'), { dataTransfer });
    expect(onBoardChange).toHaveBeenCalledWith('r1', 'COMPLETED');

    cleanup();
    render(
      <RegistrationBoard
        query={fakeQuery({ data: { items: [{ id: 'r1', patientIdLabel: '张三', status: 'COMPLETED' }], total: 1, page: 1, pageSize: 50 } })}
        renderActions={() => <button>操作</button>}
        onBoardChange={onBoardChange}
      />,
    );
    const dataTransfer2 = { setData: vi.fn(), getData: () => 'r1' };
    fireEvent.dragStart(screen.getByText('张三'), { dataTransfer: dataTransfer2 });
    fireEvent.drop(screen.getByText('候诊'), { dataTransfer: dataTransfer2 });
    expect(onBoardChange).toHaveBeenLastCalledWith('r1', 'REGISTERED');
  });
});

describe('TodayOverview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders empty defaults and truncated notices', () => {
    render(<TodayOverview data={null} />);
    expect(screen.getAllByText('今日挂号').length).toBeGreaterThan(0);
    expect(screen.getAllByText('今日预约').length).toBeGreaterThan(0);
    expect(screen.getByText('今日暂无挂号')).toBeDefined();
    expect(screen.getByText('今日暂无预约')).toBeDefined();
  });

  it('renders today lists with labels and fallbacks', () => {
    render(
      <TodayOverview
        data={{
          date: '2026-08-10',
          totals: { registrations: 2, appointments: 1, inProgressVisits: 1 },
          registrations: [
            { id: 'r1', patientName: '张三', doctorId: 'd-1', status: 'REGISTERED' },
            { id: 'r2', patientId: 'p-2', doctorName: '李医生', status: 'UNKNOWN' },
          ],
          appointments: [{ id: 'a1', patientId: 'p-3', status: 'BOOKED' }],
          truncated: { registrations: true, appointments: true },
        }}
      />,
    );
    expect(screen.getByText('今日概览（2026-08-10）')).toBeDefined();
    expect(screen.getByText('挂号超过 100 条，仅显示前 100 条')).toBeDefined();
    expect(screen.getByText('预约超过 100 条，仅显示前 100 条')).toBeDefined();
    expect(screen.getByText('未分配医生')).toBeDefined();
    expect(screen.getByText(STATUS_LABELS.REGISTERED ?? 'REGISTERED')).toBeDefined();
  });

  it('handles missing totals and partial truncation flags', () => {
    render(
      <TodayOverview
        data={{
          registrations: [{ id: 'r1', patientName: '张三', status: 'REGISTERED' }],
          appointments: [],
          totals: {},
          truncated: { registrations: true, appointments: false },
        }}
      />,
    );
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('挂号超过 100 条，仅显示前 100 条')).toBeDefined();
    expect(screen.queryByText('预约超过 100 条，仅显示前 100 条')).toBeNull();
  });

  it('renders rows with neither patient name nor id as blanks', () => {
    render(
      <TodayOverview
        data={{
          registrations: [{ id: 'r1', status: 'REGISTERED' }],
          appointments: [{ id: 'a1', status: 'BOOKED' }],
          totals: {},
        }}
      />,
    );
    expect(screen.getByText(STATUS_LABELS.REGISTERED ?? 'REGISTERED')).toBeDefined();
    expect(screen.getByText(STATUS_LABELS.BOOKED ?? 'BOOKED')).toBeDefined();
  });
});

describe('TriageQueuePanel', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders the queue, filters by department and starts a visit', async () => {
    const onStartVisit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [{ id: 'dept-1', name: '口腔内科' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/triage/queue') {
        return {
          items: [
            { id: 'q1', patientName: '张三', departmentName: '口腔内科', doctorId: 'd-1', status: 'REGISTERED' },
            { id: 'q2', patientId: 'p-2', status: 'UNKNOWN' },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        };
      }
      if (path.startsWith('/triage/queue?departmentId=')) return { items: [], total: 0, page: 1, pageSize: 50 };
      return {};
    });
    render(<TriageQueuePanel onStartVisit={onStartVisit} />, { wrapper });
    expect(await screen.findByText('张三')).toBeDefined();
    expect(screen.getAllByText('未分诊').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('科室筛选'), { target: { value: 'dept-1' } });
    expect(await screen.findByText('暂无分诊队列')).toBeDefined();

    fireEvent.change(screen.getByLabelText('科室筛选'), { target: { value: '' } });
    await screen.findByText('张三');
    fireEvent.click(screen.getByRole('button', { name: '开始就诊' }));
    await waitFor(() => {
      expect(onStartVisit).toHaveBeenCalledWith('q1');
    });
  });

  it('shows an error state with retry when the queue fails to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/triage/queue') throw new Error('Load failed');
      return {};
    });
    render(<TriageQueuePanel onStartVisit={vi.fn()} />, { wrapper });
    expect(await screen.findByText('加载分诊队列失败')).toBeDefined();
    const retry = screen.getByRole('button', { name: '重试' });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/triage/queue') {
        return {
          items: [{ id: 'q-retry', patientName: '重试患者', status: 'REGISTERED' }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      return {};
    });
    fireEvent.click(retry);
    expect(await screen.findByText('重试患者')).toBeDefined();
  });

  it('only shows start buttons for REGISTERED rows', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/triage/queue') {
        return {
          items: [
            { id: 'q1', patientName: '张三', status: 'REGISTERED' },
            { id: 'q2', patientId: 'p-2', status: 'IN_PROGRESS' },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        };
      }
      return {};
    });
    render(<TriageQueuePanel onStartVisit={vi.fn().mockResolvedValue(undefined)} />, { wrapper });
    await screen.findByText('张三');
    expect(screen.getAllByRole('button', { name: '开始就诊' })).toHaveLength(1);
  });

  it('falls back to ids and unknown labels for sparse queue rows', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [{ id: 'dept-9' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/triage/queue') {
        return {
          items: [{ id: 'q9', patientName: null, patientId: null, departmentName: null, status: 'UNKNOWN' }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      return {};
    });
    render(<TriageQueuePanel onStartVisit={vi.fn()} />, { wrapper });
    expect(await screen.findByText('dept-9')).toBeDefined();
    expect(screen.getByText('UNKNOWN')).toBeDefined();
  });

  it('starts a visit for a registered row without an id', async () => {
    const onStartVisit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/departments?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/triage/queue') {
        return {
          items: [{ patientName: '张三', status: 'REGISTERED' }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      return {};
    });
    render(<TriageQueuePanel onStartVisit={onStartVisit} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '开始就诊' }));
    await waitFor(() => {
      expect(onStartVisit).toHaveBeenCalledWith('');
    });
  });
});
