// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrescriptionForm } from './PrescriptionForm';
import { apiRequest } from '../lib/api';
import { emptyForm } from './form';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('PrescriptionForm', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('falls back to the doctor id when the doctor name is missing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [{ id: 'd-1', name: null }];
      return { items: [] };
    });
    render(<PrescriptionForm form={emptyForm()} update={vi.fn()} editing={false} />, { wrapper });
    const option = (await screen.findByRole('option', { name: 'd-1' })) as HTMLOptionElement;
    expect(option.value).toBe('d-1');
  });
});
