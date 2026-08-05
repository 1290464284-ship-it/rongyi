// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientTimelinePage } from './PatientTimelinePage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('PatientTimelinePage', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

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

  it('renders fallback labels for incomplete timeline rows', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ items: [{ id: 'patient-demo-001', name: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 'v1', startTime: null, summary: null, status: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 't1', completedDate: null, code: null, status: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 'c1', paidAt: null, number: null, status: null }], total: 1, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ id: 'f1', planDate: null, content: null, status: null }], total: 1, page: 1, pageSize: 200 });

    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('就诊记录')).toBeDefined();
    expect(screen.getByText('治疗记录')).toBeDefined();
    expect(screen.getByText('收费记录')).toBeDefined();
    expect(screen.getByText('随访记录')).toBeDefined();
  });

  it('renders an empty timeline', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    render(<PatientTimelinePage />, { wrapper });
    expect(await screen.findByText('暂无时间线记录')).toBeDefined();
  });

  it('switches patient and reloads timeline queries', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('patientId=')) {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      return {
        items: [
          { id: 'patient-demo-001', name: 'Patient A' },
          { id: 'patient-demo-002', name: 'Patient B' },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      };
    });

    render(<PatientTimelinePage />, { wrapper });
    await screen.findByText('Patient A');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'patient-demo-002' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('patientId=patient-demo-002'));
    });
  });
});
