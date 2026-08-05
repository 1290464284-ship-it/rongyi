// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Layout } from './Layout';
import { apiRequest, logout, switchClinic } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  logout: vi.fn(),
  switchClinic: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
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

function renderLayoutAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/patients" element={<div>Patients</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

describe('Layout clinic switcher', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    expect(await screen.findByText('口腔诊所管理')).toBeDefined();
    expect(screen.queryByLabelText('当前诊所')).toBeNull();
  });

  it('shows access denied when the current path is not allowed', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      });
    renderLayoutAt('/patients');
    expect(await screen.findByText('无访问权限')).toBeDefined();
  });

  it('switches clinics and signs out', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [
          { clinicId: 'clinic-1', name: 'Clinic 1' },
          { clinicId: 'clinic-2', name: 'Clinic 2' },
        ],
      });
    vi.mocked(switchClinic).mockResolvedValue();
    vi.mocked(logout).mockResolvedValue();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });

    renderLayout();
    const switcher = await screen.findByLabelText('当前诊所');
    fireEvent.change(switcher, { target: { value: 'clinic-2' } });
    await waitFor(() => {
      expect(switchClinic).toHaveBeenCalledWith('clinic-2');
    });

    fireEvent.click(screen.getByRole('button', { name: /退出登录/ }));
    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
  });
});
