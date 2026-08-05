// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImagingPage } from './ImagingPage';
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
    if (path === '/resources/imaging?page=1&pageSize=50') {
      return {
        items: [{ id: 'i-1', title: '全景片', type: 'PANORAMIC', patientId: 'p-1', doctorId: 'd-1', imageUrl: '/api/v2/files/a.png' }],
        total: 1,
        page: 1,
        pageSize: 50,
      };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('ImagingPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(uploadFile).mockReset();
  });

  it('lists imaging records with previews', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    expect(await screen.findByText('全景片')).toBeDefined();
    expect(screen.getByAltText('全景片').getAttribute('src')).toBe('http://127.0.0.1:3180/api/v2/files/a.png');
  });

  it('uploads a file and creates an imaging record', async () => {
    mockData();
    vi.mocked(uploadFile).mockResolvedValue({ id: 'file-1', filename: 'file-1.png', url: '/api/v2/files/file-1.png' });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');

    fireEvent.click(screen.getByText('上传影像'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '根尖片' } });
    const file = new File(['x'], 'root.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('图片文件'), { target: { files: [file] } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'i-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(uploadFile).toHaveBeenCalledWith(file);
      expect(apiRequest).toHaveBeenCalledWith('/resources/imaging', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/imaging' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      type: 'UNKNOWN',
      title: '根尖片',
      imageUrl: '/api/v2/files/file-1.png',
    });
    expect(body.takenAt).toBeUndefined();
    expect(await screen.findByText('影像记录已创建')).toBeDefined();
  });

  it('validates required fields', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    fireEvent.click(screen.getByText('上传影像'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并填写影像标题')).toBeDefined();
  });
});
