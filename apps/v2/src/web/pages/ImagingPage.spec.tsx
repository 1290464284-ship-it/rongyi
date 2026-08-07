// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImagingPage } from './ImagingPage';
import { apiRequest, uploadFile } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({
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
        items: [
          { id: 'i-1', title: '全景片', type: 'PANORAMIC', patientId: 'p-1', doctorId: 'd-1', imageUrl: '/api/v2/files/a.png', takenAt: '2026-01-02T03:04:00.000Z', categoryId: 'c-1', phase: 'INITIAL' },
          { id: 'i-2', title: '侧位片', type: 'CEPHALOMETRIC', patientId: 'p-1', doctorId: 'd-1', imageUrl: '/api/v2/files/b.png', takenAt: '2026-01-03T04:05:00.000Z', categoryId: 'missing-9', phase: 'FINISHED' },
        ],
        total: 2,
        page: 1,
        pageSize: 50,
      };
    }
    if (path === '/resources/imagingCategories?page=1&pageSize=100') {
      return {
        items: [
          { id: 'c-1', name: '正畸类', type: 'ORTHODONTIC', sortOrder: 1, active: true },
          { id: 'c-2', name: '美学类', type: 'AESTHETIC', sortOrder: 2, active: false },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
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
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
      expect(Array.from((screen.getByLabelText('医生') as HTMLSelectElement).options).some((option) => option.value === 'd-1')).toBe(true);
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

  it('renders category and phase selects from imagingCategories and submits them with the create payload', async () => {
    mockData();
    vi.mocked(uploadFile).mockResolvedValue({ id: 'file-1', filename: 'file-1.png', url: '/api/v2/files/file-1.png' });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');

    fireEvent.click(screen.getByText('上传影像'));
    await waitFor(() => {
      const categorySelect = screen.getByLabelText('分类') as HTMLSelectElement;
      expect(Array.from(categorySelect.options).some((option) => option.value === 'c-1' && option.textContent === '正畸类')).toBe(true);
      expect(Array.from(categorySelect.options)[0].value).toBe('');
      expect(Array.from(categorySelect.options)[0].textContent).toBe('不分类');
    });
    const phaseSelect = screen.getByLabelText('阶段') as HTMLSelectElement;
    expect(Array.from(phaseSelect.options).map((option) => option.value)).toEqual(['', 'INITIAL', 'IN_PROGRESS', 'FINISHED', 'RETENTION', 'OTHER']);
    expect(Array.from(phaseSelect.options).some((option) => option.value === 'IN_PROGRESS' && option.textContent === '治疗中')).toBe(true);

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
      expect(Array.from((screen.getByLabelText('医生') as HTMLSelectElement).options).some((option) => option.value === 'd-1')).toBe(true);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '根尖片' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByLabelText('阶段'), { target: { value: 'IN_PROGRESS' } });
    const file = new File(['x'], 'root.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('图片文件'), { target: { files: [file] } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'i-3' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/imaging', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/imaging' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      title: '根尖片',
      categoryId: 'c-1',
      phase: 'IN_PROGRESS',
    });
    expect(await screen.findByText('影像记录已创建')).toBeDefined();
  });

  it('creates and toggles imaging categories from the management panel', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');

    fireEvent.change(within(panel).getByLabelText('名称'), { target: { value: '石膏模型' } });
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'PLASTER' } });
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: '5' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-3' });
    fireEvent.click(screen.getByText('新增分类'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/imagingCategories', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/imagingCategories' && (call[1] as RequestInit)?.method === 'POST',
    );
    expect(JSON.parse(String((postCall?.[1] as RequestInit)?.body))).toEqual({
      name: '石膏模型',
      type: 'PLASTER',
      sortOrder: 5,
      active: true,
    });
    expect(await screen.findByText('影像分类已创建')).toBeDefined();

    // 行内停用切换：PATCH /resources/imagingCategories/:id {active:false}
    const categoryRow = within(panel).getByText('正畸类').closest('tr');
    expect(categoryRow).not.toBeNull();
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-1' });
    fireEvent.click(within(categoryRow as HTMLElement).getByText('停用'));
    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/resources/imagingCategories/c-1' && (call[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body))).toEqual({ active: false });
    });
  });

  it('maps categoryId to category names and phase to Chinese labels in the list', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    const listTable = screen.getByText('全景片').closest('table');
    expect(listTable).not.toBeNull();
    expect(within(listTable as HTMLElement).getByText('正畸类')).toBeDefined();
    expect(within(listTable as HTMLElement).getByText('missing-9')).toBeDefined();
    expect(within(listTable as HTMLElement).getByText('初诊')).toBeDefined();
    expect(within(listTable as HTMLElement).getByText('完成')).toBeDefined();
  });

  it('renders two images side by side with metadata when two are selected for comparison', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    const compareSection = screen.getByLabelText('影像对比');

    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-1' } });
    fireEvent.change(within(compareSection).getByLabelText('影像二'), { target: { value: 'i-2' } });

    await waitFor(() => {
      const images = within(compareSection).getAllByRole('img');
      expect(images).toHaveLength(2);
      expect(images[0].getAttribute('src')).toBe('http://127.0.0.1:3180/api/v2/files/a.png');
      expect(images[0].getAttribute('alt')).toBe('全景片');
      expect(images[1].getAttribute('src')).toBe('http://127.0.0.1:3180/api/v2/files/b.png');
      expect(images[1].getAttribute('alt')).toBe('侧位片');
    });
    expect(within(compareSection).getByText('标题：全景片')).toBeDefined();
    expect(within(compareSection).getByText('标题：侧位片')).toBeDefined();
    expect(within(compareSection).getByText('类型：PANORAMIC')).toBeDefined();
    expect(within(compareSection).getByText('阶段：初诊')).toBeDefined();
    expect(within(compareSection).getByText('阶段：完成')).toBeDefined();
    expect(within(compareSection).queryByText('请选择两张影像进行对比')).toBeNull();
  });

  it('shows a hint until two images are selected and clears the comparison', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    expect(screen.getByText('请选择两张影像进行对比')).toBeDefined();

    fireEvent.change(screen.getByLabelText('影像一'), { target: { value: 'i-1' } });
    expect(screen.getByText('请选择两张影像进行对比')).toBeDefined();

    fireEvent.change(screen.getByLabelText('影像二'), { target: { value: 'i-2' } });
    await waitFor(() => {
      expect(screen.queryByText('请选择两张影像进行对比')).toBeNull();
    });

    fireEvent.click(screen.getByText('清空对比'));
    expect(screen.getByText('请选择两张影像进行对比')).toBeDefined();
  });

  it('edits an imaging record keeping the original image', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');

    const recordRow = screen.getByText('全景片').closest('tr') as HTMLElement;
    fireEvent.click(within(recordRow).getByText('编辑'));
    await waitFor(() => {
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('全景片');
      expect((screen.getByLabelText('拍摄时间') as HTMLInputElement).value).toBe(toLocalDatetime('2026-01-02T03:04:00.000Z'));
      expect((screen.getByLabelText('分类') as HTMLSelectElement).value).toBe('c-1');
    });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '全景片（更新）' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'i-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/imaging/i-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/imaging/i-1' && (call[1] as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      title: '全景片（更新）',
      imageUrl: '/api/v2/files/a.png',
      categoryId: 'c-1',
      phase: 'INITIAL',
    });
    expect(body.takenAt).toBe(new Date(toLocalDatetime('2026-01-02T03:04:00.000Z')).toISOString());
    expect(uploadFile).not.toHaveBeenCalled();
    expect(await screen.findByText('影像记录已更新')).toBeDefined();
  });

  it('deletes an imaging record after confirmation', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    const recordRow = screen.getByText('全景片').closest('tr') as HTMLElement;
    fireEvent.click(within(recordRow).getByText('删除'));
    fireEvent.click(await screen.findByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/imaging/i-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('影像记录已删除')).toBeDefined();
  });

  it('edits and deletes imaging categories from the management panel', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');

    // 编辑：预填分类表单 → PATCH /resources/imagingCategories/:id
    const categoryRow = within(panel).getByText('正畸类').closest('tr') as HTMLElement;
    fireEvent.click(within(categoryRow).getByText('编辑'));
    await waitFor(() => {
      expect((within(panel).getByLabelText('名称') as HTMLInputElement).value).toBe('正畸类');
      expect((within(panel).getByLabelText('类型') as HTMLSelectElement).value).toBe('ORTHODONTIC');
      expect((within(panel).getByLabelText('排序') as HTMLInputElement).value).toBe('1');
      expect((within(panel).getByLabelText('启用') as HTMLInputElement).checked).toBe(true);
    });
    fireEvent.change(within(panel).getByLabelText('名称'), { target: { value: '正畸类（更新）' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-1' });
    fireEvent.click(within(panel).getByText('保存修改'));
    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/resources/imagingCategories/c-1' && (call[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body))).toEqual({
        name: '正畸类（更新）',
        type: 'ORTHODONTIC',
        sortOrder: 1,
        active: true,
      });
    });
    expect(await screen.findByText('影像分类已更新')).toBeDefined();

    // 删除：ConfirmDialog 确认 → DELETE /resources/imagingCategories/:id
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-2' });
    const row2 = within(panel).getByText('美学类').closest('tr') as HTMLElement;
    fireEvent.click(within(row2).getByText('删除'));
    fireEvent.click(await screen.findByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/imagingCategories/c-2', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('影像分类已删除')).toBeDefined();
  });
});

function toLocalDatetime(value: string): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
