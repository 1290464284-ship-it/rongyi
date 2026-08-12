// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GlobalSearchPage } from './GlobalSearchPage';

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock('../../lib/api', () => ({ apiRequest: mockApiRequest }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('GlobalSearchPage', () => {
  afterEach(() => {
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
      <MemoryRouter initialEntries={['/search?q=张']}>
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
});
