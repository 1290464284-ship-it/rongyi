// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { Layout } from './Layout';
import { apiRequest, logout, onSessionExpired, switchClinic } from '../lib/api';
import { ToastProvider } from './toast';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  logout: vi.fn(),
  onSessionExpired: vi.fn(),
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
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
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
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
    renderLayout();
    expect(await screen.findByText('蓉易口腔诊所')).toBeDefined();
    expect(screen.queryByLabelText('当前诊所')).toBeNull();
  });

  it('shows access denied when the current path is not allowed', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
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
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
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

  it('signs out and navigates to login when the session expires', async () => {
    let onExpire: (() => void) | undefined;
    vi.mocked(onSessionExpired).mockImplementation((callback: () => void) => {
      onExpire = callback;
      return vi.fn();
    });
    vi.mocked(logout).mockResolvedValue();
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );
    await screen.findByText('蓉易口腔诊所');
    expect(onSessionExpired).toHaveBeenCalled();
    expect(onExpire).toBeDefined();

    act(() => { onExpire!(); });

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
    expect(await screen.findByText('Login Page')).toBeDefined();
    expect(screen.getByText('登录状态已失效，请重新登录')).toBeDefined();
  });

  it('renders navigation and submits global search', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard', 'patients'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
    function SearchProbe() {
      const location = useLocation();
      return <div>search:{location.search}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
            <Route path="/patients" element={<SearchProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );
    expect(await screen.findByText('蓉易口腔诊所')).toBeDefined();
    expect(screen.getByRole('link', { name: /患者与预约/ })).toBeDefined();
    fireEvent.change(screen.getByLabelText('全局搜索'), { target: { value: '张三' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByText('search:?q=%E5%BC%A0%E4%B8%89')).toBeDefined();
  });

  it('toggles the sidebar and shows notification and help toasts', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
    const { container } = renderLayout();
    await screen.findByText('蓉易口腔诊所');
    const shell = container.querySelector('.shell') as HTMLElement | null;
    expect(shell?.className ?? '').not.toContain('collapsed');
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect((container.querySelector('.shell') as HTMLElement | null)?.className ?? '').toContain('collapsed');
    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    expect(await screen.findByText('暂无新通知')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(await screen.findByText('帮助文档请查看 README')).toBeDefined();
  });

  it('denies resource routes outside the current role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return {
          currentClinicId: 'clinic-1',
          clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
        };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/resource-meta') return [{ name: 'patients', roles: ['DOCTOR'] }];
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/resources/patients" element={<div>Resource Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );
    expect(await screen.findByText('无访问权限')).toBeDefined();
  });
});
