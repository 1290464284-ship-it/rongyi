// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemOperationsPage } from './SystemOperationsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

function mockFileReader(text: string) {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, _file: Blob) {
    Object.defineProperty(this, 'result', { value: text, configurable: true });
    queueMicrotask(() => {
      (this.onload as (() => void) | null)?.();
    });
  });
}

describe('SystemOperationsPage', () => {
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
    await new Promise((resolve) => setTimeout(resolve, 350));
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('Demo Patient')).toBeDefined();
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
    await new Promise((resolve) => setTimeout(resolve, 350));
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiRequest).not.toHaveBeenCalledWith('/search?q=D', expect.anything());

    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: 'Demo' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/search?')) throw 'boom';
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('搜索失败')).toBeDefined();
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
});
