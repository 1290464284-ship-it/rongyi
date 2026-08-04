// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FollowUpReportPage } from './FollowUpReportPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('FollowUpReportPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders follow-up adherence summary', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ total: 20, onTime: 16, rate: 80 });
    render(<FollowUpReportPage />, { wrapper });
    expect(await screen.findByText('随访到诊率')).toBeDefined();
    expect(screen.getByText('20')).toBeDefined();
    expect(screen.getByText('16')).toBeDefined();
    expect(screen.getByText('80%')).toBeDefined();
  });
});
