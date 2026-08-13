// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CephalometricFormFields } from './CephalometricFormFields';
import { CompareResultView } from './CompareResultView';
import { OutlineSvg } from './OutlineSvg';
import { ReportDialog } from './ReportDialog';
import { SendWechatDialog } from './SendWechatDialog';
import { cephalometricColumns } from './columns';
import { jsonToText, landmarksOutline, pointsAttr, toPoint, viewBoxFor } from './utils';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import { emptyForm, type CephalometricForm, type CephalometricRow } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('CephalometricFormFields', () => {
  afterEach(() => {
    cleanup();
  });

  it('updates every editable field and the selected file', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [{ id: 'p-1', name: '患者甲' }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    let form: CephalometricForm = emptyForm;
    const update = vi.fn((patch: Partial<CephalometricForm>) => {
      form = { ...form, ...patch };
    });
    const setFile = vi.fn();
    render(<CephalometricFormFields form={form} update={update} file={null} setFile={setFile} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    expect(update).toHaveBeenCalledWith({ patientId: 'p-1' });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'SUBMITTED' } });
    expect(update).toHaveBeenCalledWith({ status: 'SUBMITTED' });
    fireEvent.change(screen.getByLabelText('模板 ID'), { target: { value: 'tpl-1' } });
    expect(update).toHaveBeenCalledWith({ templateId: 'tpl-1' });
    fireEvent.change(screen.getByLabelText('标记点 JSON'), { target: { value: '{"sella":[1,2]}' } });
    expect(update).toHaveBeenCalledWith({ landmarksJson: '{"sella":[1,2]}' });
    fireEvent.change(screen.getByLabelText('测量结果 JSON'), { target: { value: '{"sn":70}' } });
    expect(update).toHaveBeenCalledWith({ metricsJson: '{"sn":70}' });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '随访' } });
    expect(update).toHaveBeenCalledWith({ remark: '随访' });

    const file = new File(['x'], 'ceph.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('影像文件'), { target: { files: [file] } });
    expect(setFile).toHaveBeenCalledWith(file);
    fireEvent.change(screen.getByLabelText('影像文件'), { target: { files: [] } });
    expect(setFile).toHaveBeenCalledWith(null);
  });
});

describe('cephalometric utils', () => {
  it('converts point tuples and objects', () => {
    expect(toPoint([10, 20])).toEqual({ x: 10, y: 20 });
    expect(toPoint({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(toPoint([null, 5] as unknown as [number, number])).toEqual({ x: 0, y: 5 });
    expect(toPoint({} as { x: number; y: number })).toEqual({ x: 0, y: 0 });
  });

  it('joins points into attributes with defaults', () => {
    expect(pointsAttr(undefined)).toBe('');
    expect(pointsAttr([])).toBe('');
    expect(pointsAttr([[1, 2], { x: 3, y: 4 }])).toBe('1,2 3,4');
  });

  it('computes view boxes for empty, single and populated points', () => {
    expect(viewBoxFor([])).toBe('0 0 400 300');
    expect(viewBoxFor([{ x: 10, y: 20 }])).toBe('-14 -4 49 49');
    expect(viewBoxFor([{ x: 10, y: 20 }, { x: 30, y: 40 }])).toBe('-14 -4 68 68');
  });

  it('extracts landmarks from outline and nested objects', () => {
    expect(landmarksOutline(undefined)).toEqual([]);
    expect(landmarksOutline({ outline: [[1, 2], { x: 3, y: 4 }] })).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(landmarksOutline({ sella: [10, 20], nasion: { x: 30, y: 40 }, bad: ['a', 1], skip: 'x' })).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    expect(landmarksOutline({ skip: 'x', bad: ['a', 1] })).toEqual([]);
  });

  it('serializes values to json text', () => {
    expect(jsonToText('abc')).toBe('abc');
    expect(jsonToText(null)).toBe('{}');
    expect(jsonToText(undefined)).toBe('{}');
    expect(jsonToText({ a: 1 })).toBe('{"a":1}');
  });
});

describe('OutlineSvg', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders an empty placeholder', () => {
    render(<OutlineSvg report={{ outline: [], polylines: [] }} />);
    expect(screen.getByText('暂无轮廓数据')).toBeDefined();
  });

  it('handles reports without a polylines field', () => {
    render(<OutlineSvg report={{ outline: [] }} />);
    expect(screen.getByText('暂无轮廓数据')).toBeDefined();
  });

  it('renders outline points and labelled polylines', () => {
    const { container } = render(
      <OutlineSvg
        report={{
          outline: [[100, 80], [120, 90]],
          polylines: [{ points: [[100, 80], [140, 100]], color: '#16a34a', label: 'SN' }],
          outlineColor: '#2563eb',
          lineColor: '#dc2626',
        }}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    expect(screen.getByText('SN')).toBeDefined();
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('#2563eb');
  });

  it('defaults colors when absent', () => {
    const { container } = render(<OutlineSvg report={{ outline: [[1, 2], [3, 4]], polylines: [] }} />);
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('#2563eb');
  });
});

describe('CompareResultView', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows an empty outline placeholder', () => {
    render(<CompareResultView result={{ cases: [{ id: 'c-1', landmarksJson: {} }] }} />);
    expect(screen.getByText('所选病例暂无轮廓数据')).toBeDefined();
    expect(screen.getByText('c-1')).toBeDefined();
  });

  it('renders overlay entries with metrics and remarks', () => {
    render(
      <CompareResultView
        result={{
          cases: [
            {
              id: 'c-1',
              landmarksJson: { sella: [10, 20], nasion: [30, 40] },
              metricsJson: { snLength: 70 },
              remark: '基线',
              createdAt: '2026-08-01T02:00:00.000Z',
            },
            { id: 'c-2', landmarksJson: {}, metricsJson: {} },
          ],
        }}
      />,
    );
    expect(screen.getByText(/基线/)).toBeDefined();
    expect(screen.getByText(/轮廓点 2 个/)).toBeDefined();
    expect(screen.getByText(/指标 \{"snLength":70\}/)).toBeDefined();
    expect(screen.queryByText('所选病例暂无轮廓数据')).toBeNull();
  });
});

describe('ReportDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  function mockReport() {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/cephalometric/c-1/report' && method === 'GET') {
        return {
          caseId: 'c-1',
          reportJson: {
            outline: [[100, 80]],
            polylines: [],
            outlineColor: '#2563eb',
            lineColor: '#dc2626',
          },
          metricsJson: { snLength: 71.2 },
        };
      }
      if (path === '/cephalometric/c-1/report' && method === 'POST') return { ok: true };
      return {};
    });
  }

  it('shows loading then prefilled fields and metrics', async () => {
    mockReport();
    render(<ReportDialog row={{ id: 'c-1' }} reload={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    expect(await screen.findByLabelText('报告 JSON')).toBeDefined();
    expect(await screen.findByLabelText('测量指标')).toBeDefined();
    expect(screen.getByLabelText('轮廓图预览')).toBeDefined();
  });

  it('rejects invalid JSON and array JSON before saving', async () => {
    mockReport();
    render(<ReportDialog row={{ id: 'c-1' }} reload={vi.fn()} onClose={vi.fn()} />, { wrapper });
    const area = (await screen.findByLabelText('报告 JSON')) as HTMLTextAreaElement;

    fireEvent.change(area, { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: '保存报告' }));
    expect(await screen.findByText('报告 JSON 必须是合法 JSON')).toBeDefined();

    fireEvent.change(area, { target: { value: '[1,2]' } });
    fireEvent.click(screen.getByRole('button', { name: '保存报告' }));
    expect(await screen.findByText('报告 JSON 必须是对象')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/cephalometric/c-1/report', expect.objectContaining({ method: 'POST' }));
  });

  it('shows an error toast when saving fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && path === '/cephalometric/c-1/report') {
        return { caseId: 'c-1', reportJson: { outline: [], polylines: [] } };
      }
      if (method === 'POST' && path === '/cephalometric/c-1/report') throw new Error('');
      return {};
    });
    render(<ReportDialog row={{ id: 'c-1' }} reload={vi.fn()} onClose={vi.fn()} />, { wrapper });
    await screen.findByLabelText('报告 JSON');
    fireEvent.click(screen.getByRole('button', { name: '保存报告' }));
    expect(await screen.findByText('保存报告失败')).toBeDefined();
  });

  it('keeps the report editable and shows the not-loaded toast when the report fetch fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/cephalometric/c-1/report') throw new Error('report failed');
      return {};
    });
    render(<ReportDialog row={{ id: 'c-1' }} reload={vi.fn()} onClose={vi.fn()} />, { wrapper });
    await screen.findByLabelText('报告 JSON');
    fireEvent.click(screen.getByRole('button', { name: '保存报告' }));
    expect(await screen.findByText('报告数据尚未加载完成，请稍后再试')).toBeDefined();
  });

  it('updates outline and line colors from the selects', async () => {
    mockReport();
    render(<ReportDialog row={{ id: 'c-1' }} reload={vi.fn()} onClose={vi.fn()} />, { wrapper });
    const area = await screen.findByLabelText('报告 JSON');
    fireEvent.change(screen.getByLabelText('轮廓色'), { target: { value: '#16a34a' } });
    fireEvent.change(screen.getByLabelText('折线色'), { target: { value: '#9333ea' } });
    fireEvent.click(screen.getByRole('button', { name: '保存报告' }));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/cephalometric/c-1/report' && (options as RequestInit)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
      expect(body.reportJson.outlineColor).toBe('#16a34a');
      expect(body.reportJson.lineColor).toBe('#9333ea');
    });
    expect(area).toBeDefined();
  });
});

describe('SendWechatDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('sends with optional fields and closes', async () => {
    const onClose = vi.fn();
    render(<SendWechatDialog row={{ id: 'c-1' }} onClose={onClose} />, { wrapper });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } });
    fireEvent.change(screen.getByLabelText('发送内容'), { target: { value: '报告完成' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/cephalometric/c-1/send', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/cephalometric/c-1/send');
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ phone: '13800000000', note: '报告完成' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('omits empty optional fields', async () => {
    render(<SendWechatDialog row={{ id: 'c-1' }} onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/cephalometric/c-1/send');
      const body = call ? JSON.parse(String((call[1] as RequestInit)?.body)) : null;
      expect(body).toEqual({});
    });
  });

  it('shows an error toast when sending fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    const onClose = vi.fn();
    render(<SendWechatDialog row={{ id: 'c-1' }} onClose={onClose} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('微信发送失败')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('cephalometric columns', () => {
  function renderColumn(key: string, row: CephalometricRow) {
    const column = cephalometricColumns().find((entry) => entry.key === key);
    return column && typeof column.render === 'function' ? column.render(row) : '';
  }

  it('falls back to ids and maps report status', () => {
    const row = { id: 'c-1', patientId: 'p-1', reportStatus: 'COMPLETED' };
    expect(renderColumn('patientId', row)).toBe('p-1');
    expect(renderColumn('reportStatus', row)).toBe('已完成');
  });

  it('renders labels and unknown fallback', () => {
    const row = { id: 'c-1', patientIdLabel: '患者甲', reportStatus: 'UNKNOWN' };
    expect(renderColumn('patientId', row)).toBe('患者甲');
    expect(renderColumn('reportStatus', row)).toBe('UNKNOWN');
  });
});

describe('OutlineSvg', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders empty, labeled and single-point states', () => {
    const { rerender } = render(<OutlineSvg report={{ outline: [], polylines: [] }} />);
    expect(screen.getByText('暂无轮廓数据')).toBeDefined();

    rerender(
      <OutlineSvg
        report={{
          outline: [[10, 10], [20, 20]],
          polylines: [{ points: [[10, 10], [20, 20]], color: '#16a34a', label: 'SN' }],
        }}
      />,
    );
    expect(screen.getByText('SN')).toBeDefined();
    expect(screen.queryByText('暂无轮廓数据')).toBeNull();

    rerender(<OutlineSvg report={{ outline: [[10, 10]], polylines: [{ points: [], label: undefined }] }} />);
    expect(screen.getByLabelText('轮廓图预览')).toBeDefined();
  });

  it('falls back to defaults when outline and polylines are undefined', () => {
    render(
      <OutlineSvg
        report={{
          outline: undefined,
          polylines: [{ points: undefined, color: undefined, label: undefined }],
          outlineColor: undefined,
          lineColor: undefined,
        }}
      />,
    );
    expect(screen.getByText('暂无轮廓数据')).toBeDefined();
  });
});
