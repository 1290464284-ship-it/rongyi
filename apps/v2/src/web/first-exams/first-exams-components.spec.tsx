// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FirstExamFormFields } from './FirstExamFormFields';
import { HistoryDialog } from './HistoryDialog';
import { TeethMarkDialog } from './TeethMarkDialog';
import { TrackingDialog } from './TrackingDialog';
import { TrackingOverviewBar } from './TrackingOverviewBar';
import { firstExamColumns } from './columns';
import { changeDentition, restartFirstExam, transitionFirstExam } from './actions';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import { emptyForm, type FirstExamForm, type FirstExamRow } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockLookups() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    if (path.startsWith('/resources/patients?')) {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path === '/resources/firstExamTeeth?examId=f-1&page=1&pageSize=200') {
      return {
        items: [
          { id: 't-1', examId: 'f-1', toothNumber: 16, toothStatus: 'CARIES', chiefMark: 'NONE' },
          { id: 't-2', examId: 'f-1', toothNumber: 26, toothStatus: 'HEALTHY', chiefMark: 'HORIZONTAL_SHOULD' },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      };
    }
    if (path === '/first-exams/history?patientId=p-1') {
      return [
        {
          id: 'f-1',
          patientId: 'p-1',
          status: 'DRAFT',
          followUpStatus: 'PENDING',
          dentition: 'DECIDUOUS',
          previousExamId: 'f-0',
          restartedAt: '2026-08-05T02:00:00.000Z',
          chiefComplaint: '牙痛',
          createdAt: '2026-08-01T02:00:00.000Z',
        },
        {
          id: 'f-0',
          patientId: 'p-1',
          status: 'CUSTOM',
          followUpStatus: 'CUSTOM2',
          dentition: 'CUSTOM3',
          previousExamId: null,
          restartedAt: null,
          chiefComplaint: '旧主诉',
          createdAt: '2026-07-20T02:00:00.000Z',
        },
      ];
    }
    if (method === 'POST' && path === '/first-exams/f-1/teeth/t-1/chief-mark') return { ok: true };
    if (method === 'PATCH' && path === '/first-exams/f-1/tracking') return { ok: true };
    return {};
  });
}

describe('FirstExamFormFields', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('updates every editable field', async () => {
    mockLookups();
    let form: FirstExamForm = emptyForm;
    const update = vi.fn((patch: Partial<FirstExamForm>) => {
      form = { ...form, ...patch };
    });
    render(<FirstExamFormFields form={form} update={update} />, { wrapper });

    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    expect(update).toHaveBeenCalledWith({ patientId: 'p-1' });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    expect(update).toHaveBeenCalledWith({ doctorId: 'd-1' });
    fireEvent.change(screen.getByLabelText('会诊医生'), { target: { value: 'd-1' } });
    expect(update).toHaveBeenCalledWith({ consultantId: 'd-1' });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'SUBMITTED' } });
    expect(update).toHaveBeenCalledWith({ status: 'SUBMITTED' });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '牙痛' } });
    expect(update).toHaveBeenCalledWith({ chiefComplaint: '牙痛' });
    fireEvent.change(screen.getByLabelText('现病史'), { target: { value: '三天' } });
    expect(update).toHaveBeenCalledWith({ presentIllness: '三天' });
    fireEvent.change(screen.getByLabelText('既往史'), { target: { value: '无' } });
    expect(update).toHaveBeenCalledWith({ pastHistory: '无' });
    fireEvent.change(screen.getByLabelText('口腔检查'), { target: { value: '深龋' } });
    expect(update).toHaveBeenCalledWith({ oralExam: '深龋' });
    fireEvent.change(screen.getByLabelText('辅助检查'), { target: { value: 'X线' } });
    expect(update).toHaveBeenCalledWith({ auxiliaryExam: 'X线' });
    fireEvent.change(screen.getByLabelText('诊断'), { target: { value: '龋齿' } });
    expect(update).toHaveBeenCalledWith({ diagnosis: '龋齿' });
    fireEvent.change(screen.getByLabelText('治疗建议'), { target: { value: '充填' } });
    expect(update).toHaveBeenCalledWith({ treatmentSuggestion: '充填' });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '随访' } });
    expect(update).toHaveBeenCalledWith({ remark: '随访' });
  });

  it('falls back to the id when a doctor has no name', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-9' }]);
    render(<FirstExamFormFields form={emptyForm} update={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('医生') as HTMLSelectElement).options[1].textContent).toBe('d-9');
  });
});

describe('first-exam actions', () => {
  afterEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  it('transitions status and reloads on success', async () => {
    const showToast = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    await transitionFirstExam(showToast, reload, 'f-1', 'SUBMITTED');
    expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/status', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'SUBMITTED' }),
    }));
    expect(showToast).toHaveBeenCalledWith('首诊状态已更新', 'success');
    expect(reload).toHaveBeenCalled();
  });

  it('reports status transition failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    const showToast = vi.fn();
    const reload = vi.fn();
    await transitionFirstExam(showToast, reload, 'f-1', 'APPROVED');
    expect(showToast).toHaveBeenCalledWith('状态更新失败', 'error');
    expect(reload).not.toHaveBeenCalled();
  });

  it('changes dentition and reloads on success', async () => {
    const showToast = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    await changeDentition(showToast, reload, 'f-1', 'PERMANENT');
    expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/dentition', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ dentition: 'PERMANENT' }),
    }));
    expect(showToast).toHaveBeenCalledWith('牙列已更新', 'success');
    expect(reload).toHaveBeenCalled();
  });

  it('reports dentition failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    await changeDentition(vi.fn(), vi.fn(), 'f-1', 'MIXED');
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/first-exams/f-1/dentition', expect.objectContaining({ method: 'POST' }));
  });

  it('restarts a first exam and reloads on success', async () => {
    const showToast = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    await restartFirstExam(showToast, reload, 'f-1');
    expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/restart', expect.objectContaining({ method: 'POST' }));
    expect(showToast).toHaveBeenCalledWith('首诊已重启', 'success');
    expect(reload).toHaveBeenCalled();
  });

  it('reports restart failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    await restartFirstExam(vi.fn(), vi.fn(), 'f-1');
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/first-exams/f-1/restart', expect.objectContaining({ method: 'POST' }));
  });
});

describe('HistoryDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows a missing-patient message without a patient id', async () => {
    mockLookups();
    render(<HistoryDialog row={{ id: 'f-1' }} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText('该记录缺少患者信息，无法查看历史')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/first-exams/history?patientId=', expect.anything());
  });

  it('shows loading and empty states', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise((r) => {
      resolve = r;
    }));
    render(<HistoryDialog row={{ id: 'f-1', patientId: 'p-1' }} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    resolve([]);
    expect(await screen.findByText('暂无历史记录')).toBeDefined();
  });

  it('renders history rows with labels and restart info', async () => {
    mockLookups();
    render(<HistoryDialog row={{ id: 'f-1', patientId: 'p-1' }} onClose={vi.fn()} />, { wrapper });
    expect(await screen.findByText('牙痛')).toBeDefined();
    expect(screen.getByText('乳牙列')).toBeDefined();
    expect(screen.getByText('草稿')).toBeDefined();
    expect(screen.getByText('待跟进')).toBeDefined();
    expect(screen.getByText(/已重启/)).toBeDefined();
    expect(screen.getByText('旧主诉')).toBeDefined();
    expect(screen.getByText('CUSTOM')).toBeDefined();
    expect(screen.getByText('CUSTOM2')).toBeDefined();
    expect(screen.getByText('CUSTOM3')).toBeDefined();
  });

  it('renders sparse history rows with blank and restart fallbacks', async () => {
    vi.mocked(apiRequest).mockResolvedValue([
      { id: 'f-1', patientId: 'p-1', status: null, followUpStatus: null, dentition: null, previousExamId: 'f-0', restartedAt: null, chiefComplaint: null, createdAt: '2026-08-01T02:00:00.000Z' },
      { id: 'f-0', patientId: 'p-1', status: null, followUpStatus: null, dentition: null, previousExamId: null, restartedAt: null, chiefComplaint: null, createdAt: '2026-07-20T02:00:00.000Z' },
    ]);
    render(<HistoryDialog row={{ id: 'f-1', patientId: 'p-1' }} onClose={vi.fn()} />, { wrapper });
    expect(await screen.findByText('由 f-0 重启')).toBeDefined();
    expect(screen.getByText((_content, element) => element?.textContent === '2026/8/1 10:00:00（当前）')).toBeDefined();
  });
});

describe('TeethMarkDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows the dental chart with teeth and a default selection', async () => {
    mockLookups();
    render(<TeethMarkDialog row={{ id: 'f-1' }} reload={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />, { wrapper });
    expect(await screen.findByText('16')).toBeDefined();
    expect(screen.getByText('26')).toBeDefined();
    expect(screen.getByLabelText('牙齿 16 主诉标记')).toBeDefined();
  });

  it('shows a message when there are no teeth', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    render(<TeethMarkDialog row={{ id: 'f-1' }} reload={vi.fn()} onClose={vi.fn()} />, { wrapper });
    expect(await screen.findByText('该首诊暂无牙齿记录')).toBeDefined();
  });

  it('updates a chief mark and reloads', async () => {
    mockLookups();
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<TeethMarkDialog row={{ id: 'f-1' }} reload={reload} onClose={vi.fn()} />, { wrapper });
    await screen.findByLabelText('牙齿 16 主诉标记');
    fireEvent.change(screen.getByLabelText('牙齿 16 主诉标记'), { target: { value: 'HORIZONTAL_DONE' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/teeth/t-1/chief-mark', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chiefMark: 'HORIZONTAL_DONE' }),
      }));
    });
    expect(await screen.findByText('牙齿 16 主诉标记已更新')).toBeDefined();
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('reverts the mark and shows an error toast on failure', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/first-exams/f-1/teeth/t-1/chief-mark') throw new Error('');
      if (path === '/resources/firstExamTeeth?examId=f-1&page=1&pageSize=200') {
        return {
          items: [{ id: 't-1', examId: 'f-1', toothNumber: 16, toothStatus: 'CARIES', chiefMark: 'NONE' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      return {};
    });
    render(<TeethMarkDialog row={{ id: 'f-1' }} reload={vi.fn()} onClose={vi.fn()} />, { wrapper });
    const select = (await screen.findByLabelText('牙齿 16 主诉标记')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'HORIZONTAL_SHOULD' } });
    expect(await screen.findByText('主诉标记更新失败')).toBeDefined();
    await waitFor(() => {
      expect((screen.getByLabelText('牙齿 16 主诉标记') as HTMLSelectElement).value).toBe('NONE');
    });
  });

  it('handles lower teeth, non-numeric numbers, issue marks and tooth clicks', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [
        { id: 't-1', examId: 'f-1', toothNumber: 16, toothStatus: 'CARIES', chiefMark: 'NONE' },
        { id: 't-2', examId: 'f-1', toothNumber: 31, toothStatus: null, chiefMark: 'HORIZONTAL_DONE' },
        { id: 't-3', examId: 'f-1', toothNumber: 'X', toothStatus: null, chiefMark: 'NONE' },
      ],
      total: 3,
      page: 1,
      pageSize: 200,
    });
    render(<TeethMarkDialog row={{ id: 'f-1' }} reload={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />, { wrapper });
    expect(await screen.findByText('31')).toBeDefined();
    fireEvent.click(screen.getByText('31'));
    await waitFor(() => {
      expect((screen.getByLabelText('牙齿 31 主诉标记') as HTMLSelectElement).value).toBe('HORIZONTAL_DONE');
    });
    expect(screen.getByText('牙体状态：')).toBeDefined();
  });
});

describe('TrackingDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('submits a lost status with loss reason fields', async () => {
    mockLookups();
    const reload = vi.fn().mockResolvedValue(undefined);
    const refetchOverview = vi.fn();
    const onClose = vi.fn();
    render(
      <TrackingDialog row={{ id: 'f-1', followUpStatus: 'NONE' }} reload={reload} refetchOverview={refetchOverview} onClose={onClose} />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText('追踪状态'), { target: { value: 'LOST' } });
    fireEvent.change(await screen.findByLabelText('流失原因类型'), { target: { value: 'COST' } });
    fireEvent.change(screen.getByLabelText('流失原因'), { target: { value: '价格' } });
    fireEvent.change(screen.getByLabelText('追踪备注'), { target: { value: '电话' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/tracking', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/first-exams/f-1/tracking');
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      followUpStatus: 'LOST',
      lossReasonType: 'COST',
      lossReason: '价格',
      trackingNote: '电话',
    });
    expect(body.nextFollowUpAt).toBeUndefined();
    expect(await screen.findByText('追踪状态已更新')).toBeDefined();
    expect(reload).toHaveBeenCalled();
    expect(refetchOverview).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the next follow-up date for pending statuses', async () => {
    mockLookups();
    render(
      <TrackingDialog row={{ id: 'f-1' }} reload={vi.fn().mockResolvedValue(undefined)} refetchOverview={vi.fn()} onClose={vi.fn()} />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText('追踪状态'), { target: { value: 'PENDING' } });
    const date = await screen.findByLabelText('下次跟进日期');
    fireEvent.change(date, { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/first-exams/f-1/tracking');
      const body = call ? JSON.parse(String((call[1] as RequestInit)?.body)) : null;
      expect(body).toMatchObject({ followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-20' });
    });
  });

  it('shows an error toast when the update fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    render(<TrackingDialog row={{ id: 'f-1' }} reload={vi.fn()} refetchOverview={vi.fn()} onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('更新失败')).toBeDefined();
  });
});

describe('TrackingOverviewBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders chips with data and defaults', () => {
    render(
      <TrackingOverviewBar
        data={{ NONE: 1, PENDING: 2, HORIZONTAL_SHOULD: 3, HORIZONTAL_DONE: 4, LOST: 5, total: 15, dueToday: 6 }}
      />,
    );
    expect(screen.getByText('待跟进 2')).toBeDefined();
    expect(screen.getByText('需横向转诊 3')).toBeDefined();
    expect(screen.getByText('横向已转 4')).toBeDefined();
    expect(screen.getByText('已流失 5')).toBeDefined();
    expect(screen.getByText('今日应跟进 6')).toBeDefined();
  });

  it('falls back to zero when data is missing', () => {
    render(<TrackingOverviewBar />);
    expect(screen.getByText('待跟进 0')).toBeDefined();
    expect(screen.getByText('今日应跟进 0')).toBeDefined();
  });
});

describe('first-exam columns', () => {
  function renderColumn(key: string, row: FirstExamRow) {
    const column = firstExamColumns.find((entry) => entry.key === key);
    return column && typeof column.render === 'function' ? column.render(row) : '';
  }

  it('falls back to ids and maps labels', () => {
    const row = {
      id: 'f-1',
      patientId: 'p-1',
      doctorId: 'd-1',
      status: 'DRAFT',
      followUpStatus: 'PENDING',
      dentition: 'DECIDUOUS',
      restartedAt: '2026-08-05T02:00:00.000Z',
    };
    expect(renderColumn('patientId', row)).toBe('p-1');
    expect(renderColumn('doctorId', row)).toBe('d-1');
    expect(renderColumn('status', row)).toBe('草稿');
    expect(renderColumn('followUpStatus', row)).toBe('待跟进');
    expect(renderColumn('dentition', row)).toBe('乳牙列');
    expect(renderColumn('restartedAt', row)).toContain('已重启');
  });

  it('renders labels and empty restart fallback', () => {
    const row = {
      id: 'f-1',
      patientIdLabel: '患者甲',
      doctorIdLabel: '张医生',
      status: 'UNKNOWN',
      followUpStatus: null,
      dentition: null,
      restartedAt: null,
    };
    expect(renderColumn('patientId', row)).toBe('患者甲');
    expect(renderColumn('doctorId', row)).toBe('张医生');
    expect(renderColumn('status', row)).toBe('UNKNOWN');
    expect(renderColumn('followUpStatus', row)).toBe('未追踪');
    expect(renderColumn('restartedAt', row)).toBe('');
  });
});
