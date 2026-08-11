// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomFieldsPage } from './CustomFieldsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/custom-fields?entity=patient') {
      return [
        {
          id: 'field-1',
          fieldName: 'allergies',
          label: '过敏史',
          fieldType: 'SELECT',
          optionsJson: '["青霉素","头孢"]',
          required: true,
          sortOrder: 1,
        },
      ];
    }
    if (path === '/custom-fields' && options?.method === 'POST') return { id: 'field-new' };
    if (path === '/custom-fields/field-1' && options?.method === 'PATCH') return {};
    if (path === '/custom-fields/field-1' && options?.method === 'DELETE') return {};
    throw new Error(`unexpected request ${String(options?.method ?? 'GET')} ${path}`);
  });
}

describe('CustomFieldsPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders existing fields and creates a new field', async () => {
    mockApi();
    render(<CustomFieldsPage />, { wrapper });

    expect(await screen.findByText('过敏史')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '新建字段' }));

    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '医保类型' } });
    fireEvent.change(screen.getByLabelText('字段名（字母开头）'), { target: { value: 'insuranceType' } });
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'SELECT' } });
    fireEvent.change(screen.getByLabelText('选项（每行一个）'), { target: { value: 'A\nB' } });
    fireEvent.click(screen.getByLabelText('必填'));
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const calls = vi.mocked(apiRequest).mock.calls;
      const createCall = calls.find(([path, options]) => path === '/custom-fields' && options?.method === 'POST');
      expect(createCall).toBeDefined();
      const body = JSON.parse(String(createCall![1]?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        entity: 'patient',
        label: '医保类型',
        fieldName: 'insuranceType',
        fieldType: 'SELECT',
        options: ['A', 'B'],
        required: true,
        sortOrder: 2,
      });
    });
    expect(await screen.findByText('字段已创建')).toBeDefined();
  });

  it('edits an existing field', async () => {
    mockApi();
    render(<CustomFieldsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(screen.getByText('编辑字段')).toBeDefined();
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '过敏史（更新）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const calls = vi.mocked(apiRequest).mock.calls;
      const updateCall = calls.find(([path, options]) => path === '/custom-fields/field-1' && options?.method === 'PATCH');
      expect(updateCall).toBeDefined();
      const body = JSON.parse(String(updateCall![1]?.body)) as Record<string, unknown>;
      expect(body.label).toBe('过敏史（更新）');
    });
    expect(await screen.findByText('字段已更新')).toBeDefined();
  });

  it('deletes a field after confirmation', async () => {
    mockApi();
    render(<CustomFieldsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    expect(screen.getByText(/确定删除字段「过敏史」吗/)).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/custom-fields/field-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    expect(await screen.findByText('字段已删除')).toBeDefined();
  });

  it('shows an error toast when creation fails', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('create failed'));
    render(<CustomFieldsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: '新建字段' }));
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '测试' } });
    fireEvent.change(screen.getByLabelText('字段名（字母开头）'), { target: { value: 'testField' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('shows an empty state and loading and error states', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByText('暂未配置自定义字段')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<CustomFieldsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('fields failed'));
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('keeps the field when delete confirmation is cancelled', async () => {
    mockApi();
    render(<CustomFieldsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    expect(screen.getByText(/确定删除字段「过敏史」吗/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith(
      '/custom-fields/field-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('reports update and delete failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/custom-fields?entity=patient') {
        return [
          {
            id: 'field-1',
            fieldName: 'allergies',
            label: '过敏史',
            fieldType: 'SELECT',
            optionsJson: '["青霉素","头孢"]',
            required: true,
            sortOrder: 1,
          },
        ];
      }
      if (path === '/custom-fields/field-1') throw new Error('field action failed');
      throw new Error('unexpected request');
    });
    render(<CustomFieldsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!);
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);
  });

  it('hides the options editor for non-SELECT fields', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/custom-fields?entity=patient') return [];
      if (path === '/custom-fields' && options?.method === 'POST') return { id: 'f1' };
      return {};
    });
    render(<CustomFieldsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '新建字段' }));
    expect(screen.queryByLabelText('选项（每行一个）')).toBeNull();
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText('字段名（字母开头）'), { target: { value: 't' } });
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const createCall = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/custom-fields' && options?.method === 'POST',
      );
      expect(createCall).toBeDefined();
      const body = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ fieldType: 'TEXT', options: [], sortOrder: 0 });
    });
  });

  it('closes the delete dialog through the dialog close path', async () => {
    mockApi();
    render(<CustomFieldsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    expect(await screen.findByRole('dialog', { name: '删除字段' })).toBeDefined();

    vi.useFakeTimers();
    fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog', { name: '删除字段' })).toBeNull();
    vi.useRealTimers();
    expect(apiRequest).not.toHaveBeenCalledWith('/custom-fields/field-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('renders a blank label in the delete confirmation for sparse rows', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce([{ id: 'f-x', fieldName: 'x', label: undefined, fieldType: 'TEXT' }]);
    render(<CustomFieldsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    expect(screen.getByText(/确定删除字段「」吗？/)).toBeDefined();
  });

  it('ignores a duplicate create submit while one is pending', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/custom-fields?entity=patient') return [];
      if (path === '/custom-fields' && options?.method === 'POST') {
        return await new Promise((resolve) => { resolveCreate = resolve; });
      }
      return {};
    });
    const { container } = render(<CustomFieldsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '新建字段' }));
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '字段A' } });
    fireEvent.change(screen.getByLabelText('字段名（字母开头）'), { target: { value: 'fieldA' } });
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/custom-fields' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    )).toHaveLength(1);
    resolveCreate?.({ id: 'field-new' });
  });

  it('ignores a duplicate delete confirmation while one is pending', async () => {
    let resolveDelete: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/custom-fields?entity=patient') {
        return [{ id: 'field-1', fieldName: 'allergies', label: '过敏史', fieldType: 'TEXT', required: false, sortOrder: 1 }];
      }
      if (path === '/custom-fields/field-1' && String(options?.method ?? 'GET').toUpperCase() === 'DELETE') {
        return await new Promise((resolve) => { resolveDelete = resolve; });
      }
      return {};
    });
    render(<CustomFieldsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    const confirm = screen.getAllByRole('button', { name: '删除' }).at(-1) as HTMLButtonElement;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/custom-fields/field-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'DELETE',
    )).toHaveLength(1);
    resolveDelete?.({ ok: true });
  });
});
