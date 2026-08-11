// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpDictsTab } from './FollowUpDictsTab';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const rows = [
  { id: 'd1', dictType: 'TYPE', name: '初诊类型', sortOrder: 1, active: true, remark: '备注' },
  { id: 'd2', dictType: 'CONTENT', name: '回访内容', sortOrder: 2, active: false, remark: null },
];

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path.startsWith('/resources/followUpDicts?page=1&pageSize=200')) {
      if (path.includes('dictType=CONTENT')) return { items: [rows[1]], total: 1, page: 1, pageSize: 200 };
      return { items: rows, total: 2, page: 1, pageSize: 200 };
    }
    if (method === 'POST' && path === '/resources/followUpDicts') return { id: 'd3' };
    if (method === 'PATCH' && path === '/resources/followUpDicts/d1') return { id: 'd1' };
    if (method === 'DELETE' && path === '/resources/followUpDicts/d1') return { ok: true };
    return {};
  });
}

describe('FollowUpDictsTab', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders dictionaries and filters by type', async () => {
    mockApi();
    render(<FollowUpDictsTab />, { wrapper });
    expect(await screen.findByText('初诊类型')).toBeDefined();
    expect(screen.getByText('回访内容')).toBeDefined();
    expect(screen.getAllByText('TYPE 回访类型').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('词典分类筛选'), { target: { value: 'CONTENT' } });
    expect(await screen.findByText('回访内容')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText('初诊类型')).toBeNull();
    });
  });

  it('creates and validates dictionary entries', async () => {
    mockApi();
    render(<FollowUpDictsTab />, { wrapper });
    await screen.findByText('初诊类型');
    fireEvent.click(screen.getByRole('button', { name: '新建词典项' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('请填写词典项名称')).toBeDefined();

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '复诊类型' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/followUpDicts');
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({
      dictType: 'TYPE',
      name: '复诊类型',
      sortOrder: 0,
      active: true,
    });
    expect(await screen.findByText('词典项已创建')).toBeDefined();
  });

  it('edits and deletes dictionary entries', async () => {
    mockApi();
    render(<FollowUpDictsTab />, { wrapper });
    await screen.findByText('初诊类型');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    const nameInput = screen.getByLabelText('名称') as HTMLInputElement;
    expect(nameInput.value).toBe('初诊类型');
    fireEvent.change(nameInput, { target: { value: '初诊类型（更新）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts/d1', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('词典项已更新')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/followUpDicts/d1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('词典项已删除')).toBeDefined();
  });

  it('shows loading and error states', async () => {
    let resolveList!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/followUpDicts?page=1&pageSize=200') {
        return new Promise((resolve) => {
          resolveList = resolve;
        });
      }
      return {};
    });
    render(<FollowUpDictsTab />, { wrapper });
    expect(screen.getByText('词典加载中...')).toBeDefined();
    resolveList(Promise.reject(new Error('Load failed')));
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('renders sparse dictionary rows with blank fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/followUpDicts?page=1&pageSize=200') {
        return {
          items: [{ id: 'd9', dictType: null, name: '稀疏字典', sortOrder: null, active: false, remark: null }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      return {};
    });
    render(<FollowUpDictsTab />, { wrapper });
    expect(await screen.findByText('稀疏字典')).toBeDefined();
    expect(screen.getByText('否')).toBeDefined();
  });
});
