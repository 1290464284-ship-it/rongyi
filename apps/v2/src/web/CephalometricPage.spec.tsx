// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CephalometricPage } from './CephalometricPage';
import { apiRequest, uploadFile } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  getApiOrigin: vi.fn().mockResolvedValue('http://127.0.0.1:3180'),
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
      return { items: [{ id: 'c-1', patientId: 'p-1', status: 'DRAFT', imageUrl: '/api/v2/files/x.png' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('CephalometricPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
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
});
