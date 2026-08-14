// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GlobalSearchPage } from './GlobalSearchPage';

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock('../../lib/api', () => ({ apiRequest: mockApiRequest }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

function QueryHarness({ next }: { next: string }) {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <GlobalSearchPage />
      <button type="button" onClick={() => setSearchParams({ q: next })}>navigate</button>
    </>
  );
}

describe('GlobalSearchPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(mockApiRequest).mockReset();
  });

  it('renders cross-resource results for a query', async () => {
    vi.mocked(mockApiRequest).mockResolvedValue([
      { id: 'p-1', resource: 'patients', label: '张三' },
      { id: 'c-1', resource: 'charges', label: 'CHG-1' },
    ]);
    render(
      <MemoryRouter initialEntries={['/search?q=张三']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('张三')).toBeDefined());
    expect(screen.getByText('CHG-1')).toBeDefined();
    expect(mockApiRequest).toHaveBeenCalledWith('/search?q=%E5%BC%A0%E4%B8%89');
  });

  it('asks for a longer query before searching', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=a']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    expect(screen.getByText('输入至少 2 个字符开始搜索')).toBeDefined();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('marks the active resource filter with aria-pressed', async () => {
    vi.mocked(mockApiRequest).mockResolvedValue([
      { id: 'p-1', resource: 'patients', label: '张三' },
    ]);
    render(
      <MemoryRouter initialEntries={['/search?q=张三']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('张三')).toBeDefined());
    const allButton = screen.getByRole('button', { name: '全部' });
    const patientButton = screen.getByRole('button', { name: '患者' });
    expect(allButton.getAttribute('aria-pressed')).toBe('true');
    expect(patientButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(patientButton);
    expect(patientButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the hint without a query and error and empty states', async () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    expect(screen.getByText('输入至少 2 个字符开始搜索')).toBeDefined();
    cleanup();

    vi.mocked(mockApiRequest).mockRejectedValue('string-error');
    render(
      <MemoryRouter initialEntries={['/search?q=错误']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('操作失败，请稍后重试')).toBeDefined());
    cleanup();

    vi.mocked(mockApiRequest).mockResolvedValue([
      { id: 'u-1', resource: 'unknownResource', label: undefined },
    ]);
    render(
      <MemoryRouter initialEntries={['/search?q=未知']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'unknownResource' })).toBeDefined());
    expect(screen.getByText('1 条结果')).toBeDefined();
    cleanup();

    vi.mocked(mockApiRequest).mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/search?q=空结果']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('无匹配结果')).toBeDefined());
  });

  it('resets the resource filter when the query changes', async () => {
    vi.mocked(mockApiRequest).mockImplementation(async (path: string) => {
      if (path === '/search?q=%E5%BC%A0%E4%B8%89') {
        return [{ id: 'p-1', resource: 'patients', label: '张三' }];
      }
      if (path === '/search?q=abc') {
        return [{ id: 'c-1', resource: 'charges', label: 'CHG-1' }];
      }
      return [];
    });
    render(
      <MemoryRouter initialEntries={['/search?q=张三']}>
        <QueryHarness next="abc" />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('张三')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '患者' }));
    expect(screen.getByRole('button', { name: '患者' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    await waitFor(() => expect(screen.getByText('CHG-1')).toBeDefined());
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('handles rows without a resource and filters them out', async () => {
    vi.mocked(mockApiRequest).mockResolvedValue([
      { id: 'p-1', resource: 'patients', label: '张三' },
      { id: 'x-1', label: '无资源行' },
    ]);
    render(
      <MemoryRouter initialEntries={['/search?q=张三']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('无资源行')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '患者' }));
    expect(screen.queryByText('无资源行')).toBeNull();
    expect(screen.getByText('张三')).toBeDefined();
  });

  it('renders an Error instance message for a failed search', async () => {
    vi.mocked(mockApiRequest).mockRejectedValue(new Error('Patient not found'));
    render(
      <MemoryRouter initialEntries={['/search?q=错误']}>
        <GlobalSearchPage />
      </MemoryRouter>,
      { wrapper },
    );
    expect(await screen.findByText('患者不存在')).toBeDefined();
  });
});
