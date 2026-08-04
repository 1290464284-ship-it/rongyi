// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientTimelinePage } from './PatientTimelinePage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('PatientTimelinePage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('merges visits, treatments, charges, and follow-ups into one timeline', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        items: [{ id: 'patient-demo-001', name: 'Demo Patient' }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'v1', startTime: '2026-08-04T09:00:00.000Z', summary: 'Visit A', status: 'COMPLETED' }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 't1', completedDate: '2026-08-05', name: 'Treatment B', status: 'COMPLETED' }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'c1', paidAt: '2026-08-06', number: 'CHG-1', status: 'PAID', totalAmount: 100 }],
        total: 1,
        page: 1,
        pageSize: 200,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'f1', planDate: '2026-08-07', content: 'Follow C', status: 'PENDING' }],
        total: 1,
        page: 1,
        pageSize: 200,
      });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('Visit A')).toBeDefined();
    expect(screen.getByText('Treatment B')).toBeDefined();
    expect(screen.getByText('CHG-1')).toBeDefined();
    expect(screen.getByText('Follow C')).toBeDefined();
    expect(screen.getByText('Demo Patient')).toBeDefined();
  });
});
