// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemOperationsPage } from './SystemOperationsPage';
import { apiRequest } from './api';

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
      if (path.startsWith('/bulk-import/')) return { imported: 2, failed: 0, errors: [] };
      if (path.startsWith('/search?')) return [{ id: '1', name: 'Demo Patient' }];
      return {};
    });

    render(<SystemOperationsPage />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'suppliers' } });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '[{"code":"S1","name":"Supplier"}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 2, failed 0')).toBeDefined();

    fireEvent.change(document.querySelector('input:not([type="file"])') as HTMLInputElement, { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Demo Patient')).toBeDefined();
  });

  it('loads JSON and CSV files and reports parse errors', async () => {
    mockFileReader('[{"code":"X","name":"Y"}]');
    render(<SystemOperationsPage />);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect(await screen.findByText('File loaded: 1 rows')).toBeDefined();

    mockFileReader('name,code\nA,X');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect(await screen.findByText('File loaded: 1 rows')).toBeDefined();

    mockFileReader('{"a":1}');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect(await screen.findByText('JSON must be an array of rows')).toBeDefined();

    mockFileReader('A');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect(await screen.findByText('CSV must include a header row')).toBeDefined();

    mockFileReader('[1]');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'x.json')] },
    });
    expect(await screen.findByText('Each JSON row must be an object')).toBeDefined();
  });

  it('reports import and search failures and skips short searches', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/search?')) return [];
      throw new Error('system failed');
    });

    render(<SystemOperationsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('system failed')).toBeDefined();

    fireEvent.change(document.querySelector('input:not([type="file"])') as HTMLInputElement, { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiRequest).not.toHaveBeenCalledWith('/search?q=D', expect.anything());

    fireEvent.change(document.querySelector('input:not([type="file"])') as HTMLInputElement, { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('system failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/search?')) throw 'boom';
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Search failed')).toBeDefined();
  });
});
