// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CephalometricPage } from './CephalometricPage';
import { apiRequest, getSignedFileUrl, uploadFile } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  // S-L8：默认实现让 SignedImage 始终能拿到签名 URL；afterEach 用 mockClear 保留此实现
  getSignedFileUrl: vi.fn(async (path: string) => {
    const name = path.split('/').pop() ?? 'file';
    return `http://127.0.0.1:3180${path}?exp=1750000000000&sig=sig-${name}`;
  }),
  uploadFile: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/cephalometricCases?page=1&pageSize=50') {
      return { items: [{ id: 'c-1', patientId: 'p-1', patientIdLabel: '患者甲', status: 'DRAFT', imageUrl: '/api/v2/files/x.png' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/cephalometric/c-1/report') {
      return {
        caseId: 'c-1',
        patientId: 'p-1',
        reportStatus: 'COMPLETED',
        reportJson: {
          outline: [[100, 80], [120, 90], [140, 100]],
          polylines: [{ points: [[100, 80], [140, 100]], color: '#16a34a', label: 'SN' }],
          outlineColor: '#2563eb',
          lineColor: '#dc2626',
          conclusion: '正常',
        },
        metricsJson: { snLength: 71.2 },
        landmarksJson: {},
        createdAt: '2026-08-01T02:00:00.000Z',
      };
    }
    if (path === '/cephalometric/compare') {
      return {
        cases: [
          { id: 'c-1', patientId: 'p-1', imageUrl: '/api/v2/files/x.png', landmarksJson: { sella: [10, 20], nasion: [30, 40] }, metricsJson: { snLength: 70 }, createdAt: '2026-08-01T02:00:00.000Z', remark: '基线' },
          { id: 'c-2', patientId: 'p-1', imageUrl: '/api/v2/files/y.png', landmarksJson: { sella: [12, 21], nasion: [32, 41] }, metricsJson: { snLength: 72 }, createdAt: '2026-08-03T02:00:00.000Z', remark: '随访' },
        ],
      };
    }
    return {};
  });
}

describe('CephalometricPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(getSignedFileUrl).mockClear();
    vi.mocked(uploadFile).mockReset();
  });

  it('lists and creates cephalometric cases with an uploaded image', async () => {
    mockData();
    vi.mocked(uploadFile).mockResolvedValue({ id: 'file-1', filename: 'file-1.png', url: '/api/v2/files/file-1.png' });
    render(<CephalometricPage />, { wrapper });
    expect(await screen.findByText('DRAFT')).toBeDefined();

    fireEvent.click(screen.getByText('新建测量'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    const file = new File(['x'], 'ceph.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('影像文件'), { target: { files: [file] } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(uploadFile).toHaveBeenCalledWith(file);
      expect(apiRequest).toHaveBeenCalledWith('/resources/cephalometricCases', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/cephalometricCases' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      imageUrl: '/api/v2/files/file-1.png',
      landmarksJson: '{}',
      metricsJson: '{}',
      status: 'DRAFT',
    });
    expect(body.templateId).toBeUndefined();
    expect(await screen.findByText('头影测量已创建')).toBeDefined();
  });

  it('validates JSON input', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');
    fireEvent.click(screen.getByText('新建测量'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('标记点 JSON'), { target: { value: '{bad json' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('标记点或测量结果必须是有效 JSON')).toBeDefined();
  });

  it('validates required patient and image fields', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');
    fireEvent.click(screen.getByText('新建测量'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者并上传影像或填写标记点')).toBeDefined();
  });

  it('loads and saves a report through the report dialog', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');

    fireEvent.click(screen.getByRole('button', { name: '测量报告' }));
    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.some((call) => call[0] === '/cephalometric/c-1/report')).toBe(true);
    });
    const jsonArea = (await screen.findByLabelText('报告 JSON')) as HTMLTextAreaElement;
    expect(jsonArea.value).toContain('outline');
    expect(jsonArea.value).toContain('100');

    fireEvent.change(jsonArea, { target: { value: '{"outline":[[100,80],[120,90],[140,100]],"polylines":[],"conclusion":"正常"}' } });
    fireEvent.click(screen.getByText('保存报告'));

    await waitFor(() => {
      const saveCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/cephalometric/c-1/report' && (call[1] as RequestInit)?.method === 'POST',
      );
      expect(saveCall).toBeDefined();
    });
    const saveCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/cephalometric/c-1/report' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((saveCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ reportStatus: 'COMPLETED' });
    expect(body.reportJson).toMatchObject({ outline: [[100, 80], [120, 90], [140, 100]], conclusion: '正常' });
    expect(body.reportJson.outlineColor).toBe('#2563eb');
    expect(await screen.findByText('测量报告已保存')).toBeDefined();
  });

  it('keeps the loaded measurements when saving without editing the JSON', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');

    fireEvent.click(screen.getByRole('button', { name: '测量报告' }));
    await screen.findByLabelText('报告 JSON');
    // 不做任何编辑，直接保存（回归：旧实现会用 JSON.parse('{}') 清空轮廓点）
    fireEvent.click(screen.getByText('保存报告'));

    await waitFor(() => {
      const saveCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/cephalometric/c-1/report' && (call[1] as RequestInit)?.method === 'POST',
      );
      expect(saveCall).toBeDefined();
    });
    const saveCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/cephalometric/c-1/report' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((saveCall?.[1] as RequestInit)?.body));
    expect(body.reportJson).toMatchObject({ outline: [[100, 80], [120, 90], [140, 100]], conclusion: '正常' });
    expect(body.reportJson.polylines).toHaveLength(1);
  });

  it('sends a wechat message through the send dialog', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');

    fireEvent.click(screen.getByRole('button', { name: '发送微信' }));
    fireEvent.change(await screen.findByLabelText('手机号'), { target: { value: '13800000000' } });
    fireEvent.change(screen.getByLabelText('发送内容'), { target: { value: '您的测量报告已完成' } });
    fireEvent.click(screen.getByText('发送'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/cephalometric/c-1/send', expect.objectContaining({ method: 'POST' }));
    });
    const sendCall = vi.mocked(apiRequest).mock.calls.find((call) => call[0] === '/cephalometric/c-1/send');
    const body = JSON.parse(String((sendCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ phone: '13800000000', note: '您的测量报告已完成' });
    expect(await screen.findByText('微信已发送')).toBeDefined();
  });

  it('compares outlines of multiple cases with an overlay', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');

    fireEvent.click(await screen.findByRole('checkbox', { name: /患者甲/ }));
    fireEvent.click(screen.getByText('开始比较'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/cephalometric/compare', expect.objectContaining({ method: 'POST' }));
    });
    const compareCall = vi.mocked(apiRequest).mock.calls.find((call) => call[0] === '/cephalometric/compare');
    const body = JSON.parse(String((compareCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ caseIds: ['c-1'] });
    expect(await screen.findByLabelText('轮廓重叠比较图')).toBeDefined();
    expect(screen.getByText('对比说明')).toBeDefined();
  });

  it('edits a cephalometric case keeping the original image', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe('');
    });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '随访复查' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/cephalometricCases/c-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/cephalometricCases/c-1' && (call[1] as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      status: 'DRAFT',
      imageUrl: '/api/v2/files/x.png',
      landmarksJson: '{}',
      metricsJson: '{}',
      remark: '随访复查',
    });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(await screen.findByText('头影测量已更新')).toBeDefined();
  });

  it('deletes a cephalometric case after confirmation', async () => {
    mockData();
    render(<CephalometricPage />, { wrapper });
    await screen.findByText('DRAFT');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByText('确认删除'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/cephalometricCases/c-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('头影测量已删除')).toBeDefined();
  });
});
