// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemOperationsPage } from './SystemOperationsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

function mockFileReader(text: string) {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, _file: Blob) {
    Object.defineProperty(this, 'result', { value: text, configurable: true });
    queueMicrotask(() => {
      (this.onload as (() => void) | null)?.();
    });
  });
}

describe('SystemOperationsPage', () => {
  // 防抖（300ms）走 useEffect+setTimeout。等待必须包在 act 内：防抖 setState
  // 在 act 内触发即被确定性 flush，点击时读到最新值；裸 await 睡眠会让该
  // 更新落在 act 之外，是否 flush 取决于时序 → 全量并行负载下 flaky。
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
  });

  it('imports rows and runs global search', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/bulk-import/')) return { imported: 2, failed: 0, errors: [], chunks: 1 };
      if (path.startsWith('/search?')) return [{ id: '1', name: 'Demo Patient' }];
      return {};
    });

    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'suppliers' } });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '[{"code":"S1","name":"Supplier"}]' },
    });
    fireEvent.change(screen.getByLabelText('分片大小'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(await screen.findByText('导入完成：成功 2，失败 0，分片 1')).toBeDefined();

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'Demo' } });
    // 搜索输入已防抖（300ms），等待防抖值落地后再点击。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('Demo Patient', {}, { timeout: 5000 })).toBeDefined();
  });

  it('loads JSON and CSV files and reports parse errors', async () => {
    mockFileReader('[{"code":"X","name":"Y"}]');
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect((await screen.findAllByText('已加载 1 行')).length).toBeGreaterThan(0);

    mockFileReader('name,code\nA,X');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect((await screen.findAllByText('已加载 1 行')).length).toBeGreaterThan(0);

    mockFileReader('');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect(await screen.findByText('已加载 0 行')).toBeDefined();

    mockFileReader('name,code\nA');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect((await screen.findAllByText('已加载 1 行')).length).toBeGreaterThan(0);

    mockFileReader('name,code\n"A, B",X');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect((await screen.findAllByText('已加载 1 行')).length).toBeGreaterThan(0);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain('A, B');

    mockFileReader('{"a":1}');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect(await screen.findByText('JSON 必须是行数组')).toBeDefined();

    mockFileReader('A');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect(await screen.findByText('CSV 必须包含表头行')).toBeDefined();

    mockFileReader('[1]');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect(await screen.findByText('JSON 每行必须是对象')).toBeDefined();
  });

  it('parses escaped quotes inside CSV cells', async () => {
    mockFileReader('name,code\n"a""b",X');
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    await screen.findAllByText('已加载 1 行');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain('a\\"b');
  });

  it('reports import and search failures and skips short searches', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/search?')) return [];
      throw new Error('system failed');
    });

    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'D' } });
    // 搜索输入已防抖（300ms），等待防抖值落地后再点击。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(apiRequest).not.toHaveBeenCalledWith('/search?q=D', expect.anything());

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'Demo' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/search?')) throw 'boom';
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('搜索失败')).toBeDefined();
  });

  it('ignores duplicate import and search submissions while a request is in flight', async () => {
    const pending: Array<() => void> = [];
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/bulk-import/') || path.startsWith('/search?')) {
        return new Promise((resolve) => {
          pending.push(() => resolve(
            path.startsWith('/bulk-import/')
              ? { imported: 1, failed: 0, errors: [], chunks: 1 }
              : [],
          ));
        });
      }
      return {};
    });

    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    const importButton = screen.getByRole('button', { name: '导入' });
    fireEvent.click(importButton);
    fireEvent.click(importButton);

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'Demo' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    const searchButton = screen.getByRole('button', { name: '搜索' });
    fireEvent.click(searchButton);
    fireEvent.click(searchButton);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const importCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).startsWith('/bulk-import/'));
    const searchCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).startsWith('/search?'));
    expect(importCalls).toHaveLength(1);
    expect(searchCalls).toHaveLength(1);
    pending.forEach((resolve) => resolve());
    // 让 import/search 的挂起 promise 续体（toast/setBusy(false)）在测试结束前落定，
    // 避免 act 之外的延迟状态更新告警。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('cleans audit logs with a configured retention window', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/system/audit/cleanup') return { deleted: 3 };
      return {};
    });
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(screen.getByLabelText('日志保留天数'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '立即清理' }));
    expect(await screen.findByText('已清理 3 条过期日志')).toBeDefined();
    expect(apiRequest).toHaveBeenCalledWith(
      '/system/audit/cleanup',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"retentionDays":30') }),
    );
  });

  it('validates the audit retention window and reports cleanup failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/system/audit/cleanup') throw new Error('cleanup failed');
      return {};
    });
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);

    fireEvent.change(screen.getByLabelText('日志保留天数'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '立即清理' }));
    expect(await screen.findByText('日志保留天数必须在 30 到 3650 之间')).toBeDefined();

    fireEvent.change(screen.getByLabelText('日志保留天数'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '立即清理' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders search results without ids using the row index', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/search?')) return [{ name: 'NoId Result' }];
      return {};
    });
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'Demo' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('NoId Result')).toBeDefined();
  });

  it('loads a file whose reader result is undefined as zero rows', async () => {
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      queueMicrotask(() => {
        (this.onload as (() => void) | null)?.();
      });
    });
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect(await screen.findByText('已加载 0 行')).toBeDefined();
  });

  it('ignores a stale file load after a newer selection', async () => {
    const onloads: Array<() => void> = [];
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, blob: Blob) {
      const content = (blob as File).name.startsWith('a') ? '[{"code":"STALE"}]' : '[{"code":"FRESH"}]';
      Object.defineProperty(this, 'result', { value: content, configurable: true });
      onloads.push(() => (this.onload as (() => void) | null)?.());
    });
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'a.json')] } });
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'b.json')] } });
    // 先触发旧文件（generation 1）的 onload：守卫丢弃；再触发新文件（generation 2）
    act(() => onloads[0]?.());
    act(() => onloads[1]?.());
    expect(await screen.findByText('已加载 1 行')).toBeDefined();
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain('FRESH');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).not.toContain('STALE');
    expect(screen.getAllByText('已加载 1 行')).toHaveLength(1);
  });

  it('ignores an empty file selection', async () => {
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [] },
    });
    expect(screen.queryByText(/已加载/)).toBeNull();
  });

  it('guards import and cleanup against same-tick double submits', async () => {
    const pending: Array<() => void> = [];
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/bulk-import/') || path === '/system/audit/cleanup') {
        return new Promise((resolve) => {
          pending.push(() => resolve(
            path.startsWith('/bulk-import/')
              ? { imported: 1, failed: 0, errors: [], chunks: 1 }
              : { deleted: 1 },
          ));
        });
      }
      return {};
    });
    render(<ToastProvider><SystemOperationsPage /></ToastProvider>);

    const importButton = screen.getByRole('button', { name: '导入' });
    act(() => {
      fireEvent.click(importButton);
      fireEvent.click(importButton);
    });

    fireEvent.change(screen.getByLabelText('日志保留天数'), { target: { value: '30' } });
    const cleanupButton = screen.getByRole('button', { name: '立即清理' });
    act(() => {
      fireEvent.click(cleanupButton);
      fireEvent.click(cleanupButton);
    });

    const importCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).startsWith('/bulk-import/'));
    const cleanupCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/system/audit/cleanup');
    expect(importCalls).toHaveLength(1);
    expect(cleanupCalls).toHaveLength(1);
    pending.forEach((resolve) => resolve());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });
});
