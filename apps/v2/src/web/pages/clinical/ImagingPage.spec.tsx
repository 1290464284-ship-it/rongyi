// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImagingPage } from './ImagingPage';
import { apiRequest, fetchAllPages, getSignedFileUrl, uploadFile } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  fetchAllPages: vi.fn(),
  // S-L8：默认实现让 SignedImage 始终能拿到签名 URL；afterEach 用 mockClear 保留此实现
  getSignedFileUrl: vi.fn(async (path: string) => {
    const name = path.split('/').pop() ?? 'file';
    return `http://127.0.0.1:3180${path}?exp=1750000000000&sig=sig-${name}`;
  }),
  uploadFile: vi.fn(),
}));

vi.mocked(fetchAllPages).mockImplementation(async (path: string) => {
  const data = await vi.mocked(apiRequest)(path) as { items?: unknown[] } | unknown[];
  return Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? [];
});

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
    vi.useRealTimers();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(getSignedFileUrl).mockClear();
    vi.mocked(uploadFile).mockReset();
  });

  // S-L8：SignedImage 先向 /files/:name/sign 换取短期签名 URL 再渲染 <img>
  function mockSignedUrls() {
    vi.mocked(getSignedFileUrl).mockImplementation(async (path: string) => {
      const name = path.split('/').pop() ?? 'file';
      return `http://127.0.0.1:3180${path}?exp=1750000000000&sig=sig-${name}`;
    });
  }

  it('lists imaging records with previews', async () => {
    mockData();
    mockSignedUrls();
    render(<ImagingPage />, { wrapper });
    expect(await screen.findByText('全景片')).toBeDefined();
    expect(await screen.findByAltText('全景片')).toBeDefined();
    expect(screen.getByAltText('全景片').getAttribute('src')).toBe(
      'http://127.0.0.1:3180/api/v2/files/a.png?exp=1750000000000&sig=sig-a.png',
    );
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

  it('deletes the uploaded file when creating the imaging record fails', async () => {
    mockData();
    vi.mocked(uploadFile).mockResolvedValue({ id: 'file-1', filename: 'file-1.png', url: '/api/v2/files/file-1.png' });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');

    fireEvent.click(screen.getByText('上传影像'));
    await waitFor(() => {
      expect(Array.from((screen.getByLabelText('医生') as HTMLSelectElement).options).some((option) => option.value === 'd-1')).toBe(true);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '根尖片' } });
    fireEvent.change(screen.getByLabelText('图片文件'), {
      target: { files: [new File(['x'], 'root.png', { type: 'image/png' })] },
    });
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/resources/imaging') {
        const error = new Error('create failed');
        (error as { status?: number }).status = 409;
        throw error;
      }
      return {};
    });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/files/file-1.png', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  it('deletes the uploaded file when creating the imaging record fails with a server error', async () => {
    mockData();
    vi.mocked(uploadFile).mockResolvedValue({ id: 'file-1', filename: 'file-1.png', url: '/api/v2/files/file-1.png' });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');

    fireEvent.click(screen.getByText('上传影像'));
    await waitFor(() => {
      expect(Array.from((screen.getByLabelText('医生') as HTMLSelectElement).options).some((option) => option.value === 'd-1')).toBe(true);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '根尖片' } });
    fireEvent.change(screen.getByLabelText('图片文件'), {
      target: { files: [new File(['x'], 'root.png', { type: 'image/png' })] },
    });
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/resources/imaging') {
        const error = new Error('server exploded');
        (error as { status?: number }).status = 500;
        throw error;
      }
      return {};
    });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/files/file-1.png', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  it('previews and removes the selected imaging file', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');

    fireEvent.click(screen.getByText('上传影像'));
    const file = new File(['x'], 'root.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('图片文件'), { target: { files: [file] } });
    expect(screen.getByText('root.png')).toBeDefined();
    expect(screen.getByText('1 B')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '移除 root.png' }));
    expect(screen.queryByText('root.png')).toBeNull();
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

  it('ignores a second category toggle while one is pending', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');
    await waitFor(() => {
      expect(within(panel).getByText('正畸类')).toBeDefined();
    });
    const categoryRow = within(panel).getByText('正畸类').closest('tr');
    expect(categoryRow).not.toBeNull();
    let resolvePatch: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const row = categoryRow as HTMLElement;
    fireEvent.click(within(row).getByText('停用'));
    fireEvent.click(within(row).getByText('停用'));
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/resources/imagingCategories/c-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    )).toHaveLength(1);
    resolvePatch({ id: 'c-1' });
    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) =>
        path === '/resources/imagingCategories?page=1&pageSize=100' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'GET',
      )).toBe(true);
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

  it('keeps selected compare images visible after paging back', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return {
          items: [
            { id: 'i-1', title: '全景片', type: 'PANORAMIC', patientId: 'p-1', doctorId: 'd-1', imageUrl: '/api/v2/files/a.png', takenAt: '2026-01-02T03:04:00.000Z', categoryId: 'c-1', phase: 'INITIAL' },
            ...Array.from({ length: 49 }, (_, index) => ({ id: `i-extra-${index}`, title: `补充片 ${index}`, type: 'PANORAMIC', patientId: 'p-1', doctorId: 'd-1', imageUrl: `/api/v2/files/e${index}.png`, takenAt: '2026-01-02T03:04:00.000Z', categoryId: 'c-1', phase: 'INITIAL' })),
          ],
          total: 51,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/imaging?page=2&pageSize=50') {
        return {
          items: [{ id: 'i-2', title: '侧位片', type: 'CEPHALOMETRIC', patientId: 'p-1', doctorId: 'd-1', imageUrl: '/api/v2/files/b.png', takenAt: '2026-01-03T04:05:00.000Z', categoryId: 'c-2', phase: 'FINISHED' }],
          total: 51,
          page: 2,
          pageSize: 50,
        };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '正畸类', type: 'ORTHODONTIC', sortOrder: 1, active: true }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      return {};
    });
    render(<ImagingPage />, { wrapper });
    const compareSection = await screen.findByLabelText('影像对比');
    await waitFor(() => {
      expect(within(compareSection).getAllByRole('option', { name: /全景片/ }).length).toBeGreaterThan(0);
    });
    fireEvent.click(within(compareSection).getByRole('button', { name: '下一页' }));
    await waitFor(() => {
      expect(within(compareSection).getAllByRole('option', { name: /侧位片/ }).length).toBeGreaterThan(0);
    });
    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-2' } });
    fireEvent.click(within(compareSection).getByRole('button', { name: '上一页' }));
    await waitFor(() => {
      expect(within(compareSection).getAllByRole('option', { name: /全景片/ }).length).toBeGreaterThan(0);
      expect(within(compareSection).getAllByRole('option', { name: /侧位片/ }).length).toBeGreaterThan(0);
    });
  });

  it('renders two images side by side with metadata when two are selected for comparison', async () => {
    mockData();
    mockSignedUrls();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    const compareSection = screen.getByLabelText('影像对比');

    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-1' } });
    fireEvent.change(within(compareSection).getByLabelText('影像二'), { target: { value: 'i-2' } });

    await waitFor(() => {
      const images = within(compareSection).getAllByRole('img');
      expect(images).toHaveLength(2);
      expect(images[0].getAttribute('src')).toBe('http://127.0.0.1:3180/api/v2/files/a.png?exp=1750000000000&sig=sig-a.png');
      expect(images[0].getAttribute('alt')).toBe('全景片');
      expect(images[1].getAttribute('src')).toBe('http://127.0.0.1:3180/api/v2/files/b.png?exp=1750000000000&sig=sig-b.png');
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
    // 分类列表异步加载，须等待数据行出现（避免与 h2 同步渲染竞态）
    const categoryRow = (await waitFor(() => within(panel).getByText('正畸类'))).closest('tr') as HTMLElement;
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

  it('validates the category name and reports category failures', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    fireEvent.click(screen.getByText('新增分类'));
    expect(await screen.findByText('请填写分类名称')).toBeDefined();

    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/imagingCategories' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '石膏模型' } });
    fireEvent.click(screen.getByText('新增分类'));
    expect(await screen.findByText('创建影像分类失败')).toBeDefined();
  });

  it('reports category toggle and delete failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/resources/imagingCategories/c-1') throw new Error('');
      if (method === 'DELETE' && path === '/resources/imagingCategories/c-2') throw new Error('');
      return base?.(path, init);
    });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');
    const row = (await waitFor(() => within(panel).getByText('正畸类'))).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('停用'));
    expect(await screen.findByText('更新影像分类失败')).toBeDefined();

    const row2 = within(panel).getByText('美学类').closest('tr') as HTMLElement;
    fireEvent.click(within(row2).getByText('删除'));
    fireEvent.click(await screen.findByText('确认删除'));
    expect(await screen.findByText('删除影像分类失败')).toBeDefined();
  });

  it('reports create failures with and without an uploaded file', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/imaging' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    fireEvent.click(screen.getByText('上传影像'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '根尖片' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('创建影像失败')).toBeDefined();

    cleanup();
    mockData();
    vi.mocked(uploadFile).mockRejectedValue(new Error(''));
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
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('创建影像失败')).toBeDefined();
  });

  it('enables an inactive imaging category', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');

    await waitFor(() => {
      expect(within(panel).getByRole('button', { name: '启用' })).toBeDefined();
    });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'c-2' });
    fireEvent.click(within(panel).getByRole('button', { name: '启用' }));

    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/resources/imagingCategories/c-2' && (call[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body))).toEqual({ active: true });
    });
    expect(await screen.findByText('影像分类已启用')).toBeDefined();
  });

  it('edits a category with missing fields using safe fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') {
        return {
          items: [{ id: 'c-null', name: null, type: null, sortOrder: null, active: undefined }],
          total: 1,
          page: 1,
          pageSize: 100,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [];
      return {};
    });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');
    const row = (await waitFor(() => within(panel).getByText('停用'))).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }));

    expect(await screen.findByLabelText('名称')).toBeDefined();
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('类型') as HTMLSelectElement).value).toBe('ORTHODONTIC');
    expect((screen.getByLabelText('排序') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('启用') as HTMLInputElement).checked).toBe(false);
  });

  it('falls back to a placeholder alt and empty metadata for sparse imaging rows', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return {
          items: [
            {
              id: 'i-empty',
              title: null,
              type: null,
              patientId: null,
              doctorId: null,
              imageUrl: '/api/v2/files/empty.png',
              takenAt: null,
              phase: null,
              categoryId: null,
            },
            {
              id: 'i-1',
              title: '全景片',
              type: 'PANORAMIC',
              patientId: 'p-1',
              doctorId: 'd-1',
              imageUrl: '/api/v2/files/a.png',
              takenAt: '2026-01-02T03:04:00.000Z',
              phase: 'INITIAL',
              categoryId: 'c-1',
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [];
      return {};
    });
    mockSignedUrls();
    render(<ImagingPage />, { wrapper });
    expect(await screen.findByAltText('影像')).toBeDefined();

    const compareSection = screen.getByLabelText('影像对比');
    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-empty' } });
    fireEvent.change(within(compareSection).getByLabelText('影像二'), { target: { value: 'i-1' } });
    await waitFor(() => {
      expect(within(compareSection).getByText('标题：')).toBeDefined();
      expect(within(compareSection).getByText('类型：')).toBeDefined();
      expect(within(compareSection).getByText('拍摄时间：')).toBeDefined();
    });
  });

  it('submits an explicit imaging type when the form provides one', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    fireEvent.click(screen.getByText('上传影像'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('影像类型'), { target: { value: 'PANORAMIC' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '根尖片' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'i-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      const postCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/resources/imaging' && (call[1] as RequestInit)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse(String((postCall?.[1] as RequestInit)?.body))).toMatchObject({ type: 'PANORAMIC' });
    });
  });

  it('reports update failures for categories', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/resources/imagingCategories/c-1') throw new Error('');
      return base?.(path, init);
    });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');
    const row = (await waitFor(() => within(panel).getByText('正畸类'))).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }));
    await screen.findByRole('button', { name: '保存修改' });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('更新影像分类失败')).toBeDefined();
  });

  it('toggles the category form checkbox and cancels editing', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');
    const row = (await waitFor(() => within(panel).getByText('正畸类'))).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }));

    const activeCheckbox = await screen.findByLabelText('启用');
    expect((activeCheckbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(activeCheckbox);
    expect((activeCheckbox as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(screen.getByRole('button', { name: '新增分类' })).toBeDefined();
  });

  it('cancels the delete-category dialog through the dialog close path', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('影像分类管理');
    const panel = screen.getByLabelText('影像分类管理');
    const row = (await waitFor(() => within(panel).getByText('正畸类'))).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('dialog', { name: '删除影像分类' })).toBeDefined();

    vi.useFakeTimers();
    fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog', { name: '删除影像分类' })).toBeNull();
    vi.useRealTimers();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/imagingCategories/c-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('edits a sparse imaging record with blank fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return {
          items: [{
            id: 'i-sparse',
            patientId: null,
            doctorId: null,
            type: null,
            title: null,
            description: null,
            takenAt: null,
            remark: null,
            categoryId: null,
            phase: null,
            imageUrl: null,
          }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 100 };
      if (path === '/resources/patients?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/doctors') return [];
      return {};
    });
    render(<ImagingPage />, { wrapper });
    const row = (await screen.findByText('无图片')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }));
    await screen.findByRole('button', { name: '保存' });
    expect((screen.getByLabelText('影像类型') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('分类') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('阶段') as HTMLSelectElement).value).toBe('');
  });

  it('replaces the image when editing with a new file', async () => {
    mockData();
    vi.mocked(uploadFile).mockResolvedValue({ id: 'file-new', filename: 'new.png', url: '/api/v2/files/new.png' });
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    const recordRow = screen.getByText('全景片').closest('tr') as HTMLElement;
    fireEvent.click(within(recordRow).getByText('编辑'));
    const file = new File(['x'], 'new.png', { type: 'image/png' });
    fireEvent.change(await screen.findByLabelText('图片文件'), { target: { files: [file] } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'i-1' });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(uploadFile).toHaveBeenCalledWith(file);
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/resources/imaging/i-1' && (call[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body))).toMatchObject({ imageUrl: '/api/v2/files/new.png' });
    });
  });

  it('applies placeholder alt and empty metadata to the right compare image', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return {
          items: [
            {
              id: 'i-1',
              title: '全景片',
              type: 'PANORAMIC',
              patientId: 'p-1',
              doctorId: 'd-1',
              imageUrl: '/api/v2/files/a.png',
              takenAt: '2026-01-02T03:04:00.000Z',
              phase: 'INITIAL',
              categoryId: 'c-1',
            },
            {
              id: 'i-empty',
              title: null,
              type: null,
              patientId: null,
              doctorId: null,
              imageUrl: '/api/v2/files/empty.png',
              takenAt: null,
              phase: null,
              categoryId: null,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 100 };
      if (path === '/resources/patients?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/doctors') return [];
      return {};
    });
    mockSignedUrls();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    const compareSection = screen.getByLabelText('影像对比');
    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-1' } });
    fireEvent.change(within(compareSection).getByLabelText('影像二'), { target: { value: 'i-empty' } });
    await waitFor(() => {
      expect(within(compareSection).getByAltText('影像')).toBeDefined();
      expect(within(compareSection).getAllByText('标题：').length).toBeGreaterThan(0);
    });
  });

  it('searches the compare options with the toolbar input', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    await screen.findByText('全景片');
    fireEvent.change(screen.getByLabelText('对比选项搜索'), { target: { value: '侧位' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/imaging?page=1&pageSize=50&search=%E4%BE%A7%E4%BD%8D');
    });
  });

  it('ignores stale compare selections missing from the current options page', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return { items: [{ id: 'i-1', title: '全景片', type: 'PANORAMIC', imageUrl: '/api/v2/files/a.png' }], total: 60, page: 1, pageSize: 50 };
      }
      if (path === '/resources/imaging?page=2&pageSize=50') {
        return { items: [{ id: 'i-2', title: '侧位片', type: 'CEPHALOMETRIC', imageUrl: '/api/v2/files/b.png' }], total: 60, page: 2, pageSize: 50 };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<ImagingPage />, { wrapper });
    // 列表与对比选项共享缓存（B5），「全景片」同时出现在列表单元格与对比下拉，断言改为计数
    await waitFor(() => {
      expect(screen.getAllByText('全景片').length).toBeGreaterThan(0);
    });
    const compareSection = screen.getByLabelText('影像对比');
    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-1' } });
    // 翻到第 2 页：i-1 不在当前选项页，但保留在 selectedRows
    fireEvent.click(within(compareSection).getByRole('button', { name: '下一页' }));
    await waitFor(() => {
      expect(within(compareSection).getAllByRole('option', { name: /侧位片/ }).length).toBeGreaterThan(0);
    });
    // 重新选择过期值：selectCompare 找不到行 → nullish 分支
    fireEvent.change(within(compareSection).getByLabelText('影像一'), { target: { value: 'i-1' } });
    expect(within(compareSection).getByRole('option', { name: /全景片/ })).toBeDefined();
    // 右侧过期值同样渲染 MissingSelectOption
    fireEvent.change(within(compareSection).getByLabelText('影像二'), { target: { value: 'i-2' } });
    fireEvent.click(within(compareSection).getByRole('button', { name: '上一页' }));
    await waitFor(() => {
      expect(within(compareSection).getByRole('option', { name: /侧位片/ })).toBeDefined();
    });
  });

  it('blocks a second category save while one is pending', async () => {
    mockData();
    render(<ImagingPage />, { wrapper });
    const panel = screen.getByLabelText('影像分类管理');
    await waitFor(() => {
      expect(within(panel).getByText('正畸类')).toBeDefined();
    });
    fireEvent.change(within(panel).getByLabelText('名称'), { target: { value: '新分类' } });
    let resolvePost: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));
    const form = within(panel).getByLabelText('名称').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const posts = vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/resources/imagingCategories' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(posts).toHaveLength(1);
    resolvePost({ id: 'c-3' });
    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) =>
        path === '/resources/imagingCategories?page=1&pageSize=100' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'GET',
      )).toBe(true);
    });
  });

  it('submits a blank image url for records with a null image', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/imaging?page=1&pageSize=50') {
        return {
          items: [{ id: 'i-null', title: 'NullImg', type: 'UNKNOWN', patientId: 'p-1', doctorId: 'd-1', imageUrl: null }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/imagingCategories?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      return {};
    });
    render(<ImagingPage />, { wrapper });
    // 列表与对比选项共享缓存（B5），「NullImg」同时出现在列表单元格与对比下拉，断言改为计数
    await waitFor(() => {
      expect(screen.getAllByText('NullImg').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('NullImg');
    });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'i-null' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 50 });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path, options]) =>
        path === '/resources/imaging/i-null' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
      expect(body.imageUrl).toBe('');
    });
  });
});

function toLocalDatetime(value: string): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
