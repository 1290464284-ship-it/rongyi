// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChargesPage } from './ChargesPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('ChargesPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders charges and creates a charge', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=20') {
        return {
          items: [
            { id: 'c-1', number: 'N-1', totalAmount: 100, paidAmount: 50, status: 'PARTIAL' },
            { id: 'c-2', number: null, totalAmount: null, paidAmount: null, status: null },
          ],
          total: 2,
        };
      }
      if (path === '/charges') return { id: 'c-new' };
      return {};
    });

    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('N-1')).toBeDefined();
    fireEvent.change(screen.getByDisplayValue('patient-demo-001'), { target: { value: 'patient-2' } });
    fireEvent.change(screen.getByDisplayValue('[{"name":"Examination","category":"EXAM","price":100,"quantity":1}]'), {
      target: { value: '[{"name":"Clean","category":"EXAM","price":50,"quantity":2}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create charge' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('Charge created: c-new')).toBeDefined();
  });

  it('records payment and refund', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=20') {
        return { items: [{ id: 'c-1', number: 'N-1', totalAmount: 100, paidAmount: 50, status: 'PARTIAL' }], total: 1 };
      }
      return {};
    });
    const promptSpy = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('50')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('50');

    render(<ChargesPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    expect(await screen.findByText('Payment recorded')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('Refund recorded')).toBeDefined();
    expect(promptSpy).toHaveBeenCalled();
  });

  it('reports create, payment, and refund failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=20') {
        return { items: [{ id: 'c-1', number: 'N-1', totalAmount: 100, paidAmount: 50, status: 'PARTIAL' }], total: 1 };
      }
      throw new Error('charge failed');
    });
    vi.spyOn(window, 'prompt').mockReturnValue('50');

    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.change(screen.getByDisplayValue('[{"name":"Examination","category":"EXAM","price":100,"quantity":1}]'), {
      target: { value: '{bad json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create charge' }));
    expect(await screen.findByText(/Expected property name/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(await screen.findByText('charge failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('charge failed')).toBeDefined();
  });

  it('uses generic fallback messages for non-error failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=20') {
        return { items: [{ id: 'c-1', number: 'N-1', totalAmount: 100, paidAmount: 50, status: 'PARTIAL' }], total: 1 };
      }
      throw 'boom';
    });
    vi.spyOn(window, 'prompt').mockReturnValue('50');

    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: 'Create charge' }));
    expect(await screen.findByText('Create failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(await screen.findByText('Payment failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('Refund failed')).toBeDefined();
  });
});
