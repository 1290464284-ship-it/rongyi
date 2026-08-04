// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClinicalWorkflowPage } from './ClinicalWorkflowPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

function resourceData() {
  return {
    '/resources/registrations?page=1&pageSize=100': { items: [{ id: 'r-1', status: 'REGISTERED' }], total: 1 },
    '/resources/visits?page=1&pageSize=100': { items: [{ id: 'v-1', status: 'IN_PROGRESS' }], total: 1 },
    '/resources/firstExams?page=1&pageSize=100': { items: [{ id: 'f-1', status: 'DRAFT' }], total: 1 },
    '/resources/treatments?page=1&pageSize=100': { items: [{ id: 't-1', status: 'PLANNED' }], total: 1 },
  } as Record<string, unknown>;
}

describe('ClinicalWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders workflow tables and transitions resources', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => resourceData()[path] ?? {});

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: 'TRIAGED' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'COMPLETED' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/visits/v-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'SUBMITTED' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/status', expect.objectContaining({ method: 'PATCH' }));
    });

    const inProgressButtons = screen.getAllByRole('button', { name: 'IN_PROGRESS' });
    fireEvent.click(inProgressButtons[inProgressButtons.length - 1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatments/t-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw new Error('transition failed');
    });

    render(<ClinicalWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: 'TRIAGED' }))[0]);
    expect(await screen.findByText('transition failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path in resourceData()) return resourceData()[path];
      throw 'boom';
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'TRIAGED' })[0]);
    expect(await screen.findByText('Transition failed')).toBeDefined();
  });
});
