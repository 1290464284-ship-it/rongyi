// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Layout } from './Layout';
import { apiRequest } from './api';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  logout: vi.fn(),
  switchClinic: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

describe('Layout clinic switcher', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows a clinic switcher for users with multiple clinics', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [
          { clinicId: 'clinic-1', name: 'Clinic 1' },
          { clinicId: 'clinic-2', name: 'Clinic 2' },
        ],
      });
    renderLayout();
    expect(await screen.findByLabelText('当前诊所')).toBeDefined();
    expect(screen.getByRole('option', { name: 'Clinic 2' })).toBeDefined();
  });

  it('hides the clinic switcher for single-clinic users', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      });
    renderLayout();
    expect(await screen.findByText('Dental V2')).toBeDefined();
    expect(screen.queryByLabelText('当前诊所')).toBeNull();
  });
});
