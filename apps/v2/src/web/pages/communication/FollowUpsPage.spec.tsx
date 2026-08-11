// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpsPage } from './FollowUpsPage';
import { apiRequest, downloadCsvPath } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn(), downloadCsvPath: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function submitDialog(value = 'done') {
  const input = await screen.findByPlaceholderText('例如：已电话回访，患者情况正常');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '确认完成' }));
}

describe('FollowUpsPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(downloadCsvPath).mockReset();
  });

  it('completes a pending follow-up through the dialog', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'fu-1', patientName: '示例患者', planDate: dateKey(new Date()), status: 'PENDING', content: '回访' }];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '完成随访' }));
    await submitDialog('done');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-1/complete', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ result: 'done' }),
      }));
    });
    expect(await screen.findByText('随访已完成')).toBeDefined();
  });

  it('generates follow-ups in batch and reports failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-generate') throw new Error('batch failed');
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '批量生成随访' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: '批量生成随访' }));
    expect(await screen.findByText('批量生成完成')).toBeDefined();
  });

  it('reports follow-up completion failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-2', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 1, today: 0, upcoming: 0 };
      if (path === '/follow-ups/fu-2/complete') throw new Error('complete failed');
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '完成随访' }));
    await submitDialog();
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('uses generic fallback messages for non-error failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-3', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 0, upcoming: 1 };
      throw 'boom';
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '批量生成随访' }));
    expect(await screen.findByText('批量生成失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '完成随访' }));
    await submitDialog();
    expect(await screen.findByText('随访完成操作失败')).toBeDefined();
  });

  it('batch completes selected follow-ups and exports overdue reminders', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [
          { id: 'fu-batch-1', patientName: '批量一', planDate: '2026-08-01', status: 'PENDING' },
          { id: 'fu-batch-2', patientName: '批量二', planDate: '2026-08-01', status: 'PENDING' },
        ];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 2, overdue: 2, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-complete') return { completed: 2, skipped: 0, errors: [] };
      return {};
    });
    vi.mocked(downloadCsvPath).mockResolvedValue(undefined);

    render(<FollowUpsPage />, { wrapper });
    const checkboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    await submitDialog();

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/batch-complete', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['fu-batch-1', 'fu-batch-2'], result: 'done' }),
      }));
    });
    expect(await screen.findByText('完成 2 条，跳过 0 条')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '导出逾期' }));
    await waitFor(() => {
      expect(downloadCsvPath).toHaveBeenCalledWith('/follow-ups/reminders/export?scope=overdue', 'overdue-follow-ups.csv');
    });
  });

  it('reports batch completion and export failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-batch-fail', planDate: '2026-08-01', status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 1, today: 0, upcoming: 0 };
      if (path === '/follow-ups/batch-complete') throw new Error('batch complete failed');
      return {};
    });
    vi.mocked(downloadCsvPath).mockRejectedValueOnce(new Error('export failed'));

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    await submitDialog();
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '导出逾期' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('completes with an empty result and covers missing summary data', async () => {
    const now = new Date();
    const todayKey = dateKey(now);
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'fu-empty', patientName: '空结果', planDate: todayKey, status: null }];
      }
      if (path === '/follow-ups/reminders/summary') return undefined;
      if (path === '/follow-ups/fu-empty/complete') return {};
      if (path === '/follow-ups/batch-complete') return { completed: 1, skipped: 0, errors: [] };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    await submitDialog('');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/batch-complete', expect.objectContaining({
        body: JSON.stringify({ ids: ['fu-empty'] }),
      }));
    });
    expect(await screen.findByText('完成 1 条，跳过 0 条')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '完成随访' }));
    await submitDialog('');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/fu-empty/complete', expect.objectContaining({
        body: JSON.stringify({}),
      }));
    });
  });

  it('renders due-state summary and groups follow-ups by date', async () => {
    const now = new Date();
    const todayKey = dateKey(now);
    const yesterday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [
          { id: 'fu-overdue', patientName: '逾期患者', planDate: yesterday, status: 'PENDING' },
          { id: 'fu-today', patientName: '今日患者', planDate: todayKey, status: 'PENDING' },
          { id: 'fu-upcoming', patientName: '后续患者', planDate: tomorrow, status: 'PENDING' },
        ];
      }
      return { total: 3, overdue: 1, today: 1, upcoming: 1 };
    });

    render(<FollowUpsPage />, { wrapper });
    expect(await screen.findByText('总计：3')).toBeDefined();
    expect(screen.getByText('已逾期：1')).toBeDefined();
    expect(screen.getByText('今日：1')).toBeDefined();
    expect(screen.getByText('后续：1')).toBeDefined();
    expect(await screen.findByText(`已逾期 (1)`)).toBeDefined();
    expect(screen.getByText('今日待随访 (1)')).toBeDefined();
    expect(screen.getByText('后续待随访 (1)')).toBeDefined();
    expect(screen.getByText('逾期患者')).toBeDefined();
    expect(screen.getByText('后续患者')).toBeDefined();
  });

  it('shows a truncation hint when reminders exceed the page size', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return {
          items: [{ id: 'fu-trunc', patientName: '截断患者', planDate: dateKey(new Date()), status: 'PENDING' }],
          total: 150,
          page: 1,
          pageSize: 100,
          truncated: true,
        };
      }
      if (path === '/follow-ups/reminders/summary') return { total: 150, overdue: 150, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    expect(await screen.findByText('随访提醒超过 100 条，仅显示前 1 条')).toBeDefined();
  });

  it('cancels the completion dialog without changing state', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'fu-cancel', planDate: dateKey(new Date()), status: 'PENDING' }];
      return { total: 1, overdue: 0, today: 1, upcoming: 0 };
    });
    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '完成随访' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders NPS chips from the nps endpoint', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') {
        return { total: 10, promoters: 5, passives: 3, detractors: 2, nps: 30, average: 7.8, breakdown: [] };
      }
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    expect(await screen.findByText('NPS 得分：30')).toBeDefined();
    expect(screen.getByText('推荐者：5')).toBeDefined();
    expect(screen.getByText('中立者：3')).toBeDefined();
    expect(screen.getByText('贬损者：2')).toBeDefined();
    expect(screen.getByText('平均评分：7.8')).toBeDefined();
  });

  it('records a follow-up execution through the dialog', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'f-1', patientName: '执行患者', planDate: dateKey(new Date()), status: 'PENDING', content: '回访' }];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 1, promoters: 1, passives: 0, detractors: 0, nps: 100, average: 9, breakdown: [] };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '执行随访' }));
    fireEvent.change(screen.getByLabelText('执行状态'), { target: { value: 'DONE' } });
    fireEvent.change(screen.getByLabelText('患者评分（0-10）'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('疼痛度（0-10）'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('反馈'), { target: { value: '状态良好' } });
    fireEvent.change(screen.getByLabelText('联系时间'), { target: { value: '2026-08-05T09:30' } });
    fireEvent.change(screen.getByLabelText('下次随访日期'), { target: { value: '2026-09-05' } });
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/follow-ups/f-1/execute', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          executionStatus: 'DONE',
          patientRating: 9,
          painLevel: 2,
          feedback: '状态良好',
          contactedAt: '2026-08-05T09:30',
          nextPlanDate: '2026-09-05',
        }),
      }));
    });
    expect(await screen.findByText('随访执行已记录')).toBeDefined();
  });

  it('reports follow-up execution failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [{ id: 'f-2', planDate: dateKey(new Date()), status: 'PENDING' }];
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path === '/follow-ups/f-2/execute') throw new Error('execute failed');
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '执行随访' }));
    fireEvent.change(screen.getByLabelText('患者评分（0-10）'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('switches to dict management and lists follow-up dictionary entries', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path === '/resources/followUpDicts?page=1&pageSize=200') {
        return {
          items: [
            { id: 'd-1', dictType: 'TYPE', name: '初诊回访', sortOrder: 1, active: true, remark: '备注A' },
            { id: 'd-2', dictType: 'RESULT', name: '满意', sortOrder: 2, active: false, remark: null },
          ],
          total: 2,
        };
      }
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '词典管理' }));
    expect(await screen.findByText('初诊回访')).toBeDefined();
    expect(screen.getByText('满意')).toBeDefined();
    expect(screen.getByText('备注A')).toBeDefined();
    expect(screen.getByText('是')).toBeDefined();
    expect(screen.getByText('否')).toBeDefined();
    expect(screen.getAllByText('RESULT 回访结果').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts?page=1&pageSize=200');
    });
  });

  it('creates a follow-up dictionary entry via POST', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path === '/resources/followUpDicts?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/followUpDicts') return { id: 'd-new' };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '词典管理' }));
    await screen.findByText('暂无词典项');
    fireEvent.click(screen.getByRole('button', { name: '新建词典项' }));
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'CONTENT' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '术后回访' } });
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('启用'));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '拆线后' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/followUpDicts' && options?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      dictType: 'CONTENT',
      name: '术后回访',
      sortOrder: 2,
      active: false,
      remark: '拆线后',
    });
    expect(await screen.findByText('词典项已创建')).toBeDefined();
  });

  it('updates a follow-up dictionary entry via PATCH', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path === '/resources/followUpDicts?page=1&pageSize=200') {
        return { items: [{ id: 'd-1', dictType: 'TYPE', name: '初诊回访', sortOrder: 1, active: true, remark: '备注A' }], total: 1 };
      }
      if (path === '/resources/followUpDicts/d-1') return { id: 'd-1' };
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '词典管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('初诊回访');
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '复诊回访' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts/d-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/followUpDicts/d-1' && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      dictType: 'TYPE',
      name: '复诊回访',
      sortOrder: 1,
      active: true,
      remark: '备注A',
    });
    expect(await screen.findByText('词典项已更新')).toBeDefined();
  });

  it('deletes a follow-up dictionary entry after confirmation', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path === '/resources/followUpDicts?page=1&pageSize=200') {
        return { items: [{ id: 'd-1', dictType: 'TYPE', name: '初诊回访', sortOrder: 1, active: true, remark: '备注A' }], total: 1 };
      }
      if (path === '/resources/followUpDicts/d-1') return {};
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '词典管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    expect(await screen.findByText('确定删除该词典项吗？')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts/d-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('词典项已删除')).toBeDefined();
  });

  it('filters dictionary entries by dictType', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path.startsWith('/resources/followUpDicts')) {
        return { items: [{ id: 'd-1', dictType: 'RESULT', name: '满意', sortOrder: 1, active: true }], total: 1 };
      }
      return {};
    });

    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '词典管理' }));
    await screen.findByText('满意');
    fireEvent.change(screen.getByLabelText('词典分类筛选'), { target: { value: 'RESULT' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts?page=1&pageSize=200&dictType=RESULT');
    });
    expect(await screen.findByText('满意')).toBeDefined();
  });

  it('shows an error state and retries the follow-up queries', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') throw 'load failed';
      return {};
    });
    render(<FollowUpsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('随访管理')).toBeDefined();
  });

  it('switches back to the follow-up list tab', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') return [];
      if (path === '/follow-ups/reminders/summary') return { total: 0, overdue: 0, today: 0, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, average: 0, breakdown: [] };
      if (path === '/resources/followUpDicts?page=1&pageSize=200') return { items: [], total: 0 };
      return {};
    });
    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '词典管理' }));
    await screen.findByText('暂无词典项');
    fireEvent.click(screen.getByRole('tab', { name: '回访列表' }));
    expect(screen.getByRole('button', { name: '批量生成随访' })).toBeDefined();
  });

  it('closes the execution dialog without submitting', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/follow-ups/reminders') {
        return [{ id: 'f-1', patientName: '执行患者', planDate: dateKey(new Date()), status: 'PENDING', content: '回访' }];
      }
      if (path === '/follow-ups/reminders/summary') return { total: 1, overdue: 0, today: 1, upcoming: 0 };
      if (path === '/follow-ups/nps') return { total: 1, promoters: 1, passives: 0, detractors: 0, nps: 100, average: 9, breakdown: [] };
      return {};
    });
    render(<FollowUpsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '执行随访' }));
    expect(await screen.findByRole('dialog', { name: '执行随访' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/follow-ups/f-1/execute', expect.anything());
  });
});
