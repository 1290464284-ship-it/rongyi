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

const noRetryWrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
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
          <Route path="/search" element={<div>Search</div>} />
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
    localStorage.clear();
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

  it('shows an error and keeps the previous clinic when switching fails', async () => {
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
    vi.mocked(switchClinic).mockRejectedValue(new Error('切换诊所失败'));
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });

    renderLayout();
    const switcher = await screen.findByLabelText('当前诊所') as HTMLSelectElement;
    fireEvent.change(switcher, { target: { value: 'clinic-2' } });

    expect(await screen.findByText('切换诊所失败')).toBeDefined();
    expect(reload).not.toHaveBeenCalled();
    expect(switcher.value).toBe('clinic-1');
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
      .mockResolvedValueOnce({ permissions: ['dashboard', 'frontDesk', 'patients'] })
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
            <Route path="/search" element={<SearchProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );
    expect(await screen.findByText('蓉易口腔诊所')).toBeDefined();
    expect(screen.getByRole('link', { name: /前台工作/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /患者档案/ })).toBeDefined();
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
    expect(await screen.findByRole('heading', { name: '快捷键与帮助' })).toBeDefined();
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

  it('reopens onboarding from help and completes it', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'] };
      if (path === '/auth/clinics') {
        return {
          currentClinicId: 'clinic-1',
          clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
        };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      return {};
    });
    renderLayout();

    fireEvent.click(await screen.findByRole('button', { name: '帮助' }));
    fireEvent.click(screen.getByRole('button', { name: '重新查看新手引导' }));
    expect(await screen.findByRole('heading', { name: '新手引导' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(localStorage.getItem('v2-onboarding-done')).toBe('1');
    expect(screen.queryByRole('heading', { name: '新手引导' })).toBeNull();
  });

  it('treats onboarding as incomplete when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'] };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      return {};
    });
    renderLayout();
    expect(await screen.findByRole('heading', { name: '新手引导' })).toBeDefined();
  });

  it('shows the sidebar backup state', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return {
          currentClinicId: 'clinic-1',
          clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
        };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/backups') {
        return [{ createdAt: '2026-08-10T03:00:00.000Z' }];
      }
      return {};
    });
    renderLayout();

    expect(await screen.findByText('数据已同步')).toBeDefined();
    expect(screen.getByRole('button', { name: '备份设置' })).toBeDefined();
  });

  it('handles keyboard shortcuts', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
    renderLayout();
    await screen.findByText('蓉易口腔诊所');
    const search = screen.getByLabelText('全局搜索') as HTMLInputElement;
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: '?' });
    expect(screen.queryByRole('heading', { name: '快捷键与帮助' })).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByRole('heading', { name: '快捷键与帮助' })).toBeDefined();
  });

  it('shows navigation errors and retries', async () => {
    let fail = true;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') {
        if (fail) throw new Error('nav failed');
        return { permissions: ['dashboard'] };
      }
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper: noRetryWrapper },
    );
    expect(await screen.findByText('无法加载导航权限，请稍后重试')).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('蓉易口腔诊所')).toBeDefined();
  });

  it('shows resource metadata loading and error states with retry', async () => {
    let resolveMeta: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/resource-meta') {
        return await new Promise((resolve) => { resolveMeta = resolve; });
      }
      if (path === '/backups') return [];
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
            <Route path="/patients" element={<div>Patients</div>} />
            <Route path="/resources/patients" element={<div>Resource Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper: noRetryWrapper },
    );
    expect(await screen.findByText('加载中...')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resource-meta');
    });
    resolveMeta?.([{ name: 'patients', roles: ['BOSS'] }]);
    expect((await screen.findAllByText('蓉易口腔诊所')).length).toBeGreaterThan(0);

    cleanup();
    let fail = true;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/resource-meta') {
        if (fail) throw new Error('meta failed');
        return [{ name: 'patients', roles: ['BOSS'] }];
      }
      if (path === '/backups') return [];
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
            <Route path="/patients" element={<div>Patients</div>} />
            <Route path="/resources/patients" element={<div>Resource Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper: noRetryWrapper },
    );
    expect(await screen.findByText('无法加载资源信息，请稍后重试')).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect((await screen.findAllByText('蓉易口腔诊所')).length).toBeGreaterThan(0);
  });

  it('renders backup time labels for different ages and invalid values', async () => {
    const renderWithBackups = (backups: Array<Record<string, unknown>>) => {
      vi.mocked(apiRequest).mockImplementation(async (path: string) => {
        if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
        if (path === '/auth/clinics') {
          return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
        }
        if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
        if (path === '/backups') return backups;
        return {};
      });
      renderLayout();
    };
    const now = Date.now();
    renderWithBackups([{ createdAt: new Date(now - 30_000).toISOString() }]);
    expect(await screen.findByText('刚刚')).toBeDefined();

    cleanup();
    renderWithBackups([
      { createdAt: new Date(now - 5 * 86_400_000).toISOString() },
      { createdAt: new Date(now - 5 * 3_600_000).toISOString() },
    ]);
    expect(await screen.findByText('5 小时前')).toBeDefined();

    cleanup();
    renderWithBackups([{ createdAt: new Date(now - 5 * 60_000).toISOString() }]);
    expect(await screen.findByText('5 分钟前')).toBeDefined();

    cleanup();
    renderWithBackups([{ createdAt: new Date(now - 5 * 86_400_000).toISOString() }]);
    expect(await screen.findByText('5 天前')).toBeDefined();

    cleanup();
    renderWithBackups([{ createdAt: 'not-a-date' }]);
    expect(await screen.findByText('not-a-date')).toBeDefined();
  });

  it('navigates to the system page from the backup card and closes help', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard', 'system'], role: 'BOSS' })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' })
      .mockResolvedValueOnce([{ createdAt: '2026-08-10T03:00:00.000Z' }]);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
            <Route path="/system" element={<div>System Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );
    fireEvent.click(await screen.findByRole('button', { name: '备份设置' }));
    expect(await screen.findByText('System Page')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    fireEvent.click(await screen.findByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '快捷键与帮助' })).toBeNull();
    });
  });

  it('submits an empty global search to the search page', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard', 'patients'] })
      .mockResolvedValueOnce({
        currentClinicId: 'clinic-1',
        clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
    renderLayoutAt('/');
    await screen.findByText('蓉易口腔诊所');
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByText('Search')).toBeDefined();
  });

  it('renders the username when the display name is empty and sorts backups without timestamps', async () => {
    const now = Date.now();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '', username: 'wangli' };
      if (path === '/backups') {
        return [{ createdAt: undefined }, { createdAt: new Date(now - 5 * 60_000).toISOString() }];
      }
      return {};
    });
    renderLayout();
    expect(await screen.findByText('wangli')).toBeDefined();
    expect(await screen.findByText('5 分钟前')).toBeDefined();
  });

  it('sorts backups with a missing timestamp in the middle', async () => {
    const now = Date.now();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/backups') {
        return [
          { createdAt: new Date(now - 5 * 86_400_000).toISOString() },
          { createdAt: undefined },
          { createdAt: new Date(now - 5 * 60_000).toISOString() },
        ];
      }
      return {};
    });
    renderLayout();
    expect(await screen.findByText('5 分钟前')).toBeDefined();
  });

  it('denies resource routes when the definition has no roles', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/resource-meta') return [{ name: 'patients' }];
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
            <Route path="/patients" element={<div>Patients</div>} />
            <Route path="/resources/patients" element={<div>Resource Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper: noRetryWrapper },
    );
    expect(await screen.findByText('无访问权限')).toBeDefined();
  });

  it('denies resource routes when the navigation omits the role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'] };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return { name: '王丽', username: 'wangli' };
      if (path === '/resource-meta') return [{ name: 'patients', roles: ['BOSS'] }];
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home</div>} />
            <Route path="/resources/patients" element={<div>Resource Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper: noRetryWrapper },
    );
    expect(await screen.findByText('无访问权限')).toBeDefined();
  });

  it('falls back to an empty clinic selection and a generic switch error', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ permissions: ['dashboard'], role: 'BOSS' })
      .mockResolvedValueOnce({
        currentClinicId: null,
        clinics: [
          { clinicId: 'clinic-1', name: 'Clinic 1' },
          { clinicId: 'clinic-2', name: 'Clinic 2' },
        ],
      })
      .mockResolvedValueOnce({ name: '王丽', username: 'wangli' });
    vi.mocked(switchClinic).mockRejectedValue('plain failure');
    renderLayout();
    const switcher = (await screen.findByLabelText('当前诊所')) as HTMLSelectElement;
    expect(switcher.options).toHaveLength(2);
    fireEvent.change(switcher, { target: { value: 'clinic-2' } });
    expect(await screen.findByText('切换诊所失败')).toBeDefined();
    // 失败后回退到旧值（null → 空选中，DOM 落回首个选项）
    expect((screen.getByLabelText('当前诊所') as HTMLSelectElement).value).toBe('clinic-1');
  });

  it('renders without a crash when the me query resolves undefined', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { permissions: ['dashboard'], role: 'BOSS' };
      if (path === '/auth/clinics') {
        return { currentClinicId: 'clinic-1', clinics: [{ clinicId: 'clinic-1', name: 'Clinic 1' }] };
      }
      if (path === '/auth/me') return undefined;
      if (path === '/backups') return [];
      return {};
    });
    renderLayout();
    expect(await screen.findByText('跳到主内容')).toBeDefined();
    expect(screen.getByText('蓉易口腔诊所')).toBeDefined();
  });
});
