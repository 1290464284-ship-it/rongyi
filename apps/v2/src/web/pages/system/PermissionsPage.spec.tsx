// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionsPage } from './PermissionsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const doctorPermissions = {
  items: [
    { resource: 'finance', allowed: true },
    { resource: 'patients', allowed: false },
  ],
  defaults: ['dashboard', 'patients', 'clinical', 'communication'],
  effective: ['dashboard', 'clinical', 'communication', 'finance'],
};

const bossPermissions = {
  items: [],
  defaults: [
    'dashboard',
    'patients',
    'clinical',
    'finance',
    'inventory',
    'analytics',
    'communication',
    'hr',
    'system',
  ],
  effective: [
    'dashboard',
    'patients',
    'clinical',
    'finance',
    'inventory',
    'analytics',
    'communication',
    'hr',
    'system',
  ],
};

describe('PermissionsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('loads role permissions and renders module checkboxes from effective permissions', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      return {};
    });
    render(<PermissionsPage />, { wrapper });
    expect(await screen.findByText('医生默认模块权限')).toBeDefined();
    expect(screen.getByLabelText('收费财务')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('患者档案')).toHaveProperty('checked', false);
    expect(screen.getByLabelText('临床诊疗')).toHaveProperty('checked', true);
  });

  it('switches role tabs and refetches permissions', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      if (path === '/role-permissions/BOSS') return bossPermissions;
      return {};
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('医生默认模块权限');
    fireEvent.click(screen.getByRole('tab', { name: '老板' }));
    expect(await screen.findByText('老板默认模块权限')).toBeDefined();
    expect(screen.getByLabelText('人事排班')).toHaveProperty('checked', true);
  });

  it('exposes tab semantics and supports arrow-key navigation', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      if (path === '/role-permissions/BOSS') return bossPermissions;
      return {};
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('医生默认模块权限');

    const doctorTab = screen.getByRole('tab', { name: '医生' });
    const adminTab = screen.getByRole('tab', { name: '管理员' });
    const bossTab = screen.getByRole('tab', { name: '老板' });
    expect(doctorTab.getAttribute('aria-selected')).toBe('true');
    expect(adminTab.getAttribute('aria-selected')).toBe('false');
    expect(doctorTab.getAttribute('aria-controls')).toBe('permissions-panel');
    expect(bossTab.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('permission-tab-DOCTOR');

    fireEvent.keyDown(doctorTab, { key: 'ArrowRight' });
    const activeBossTab = screen.getByRole('tab', { name: '老板' });
    expect(document.activeElement).toBe(activeBossTab);
    expect(activeBossTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '医生' }).getAttribute('aria-selected')).toBe('false');
    expect(await screen.findByText('老板默认模块权限')).toBeDefined();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('permission-tab-BOSS');

    fireEvent.keyDown(activeBossTab, { key: 'ArrowLeft' });
    const focusedDoctorTab = screen.getByRole('tab', { name: '医生' });
    expect(document.activeElement).toBe(focusedDoctorTab);
    expect(screen.getByRole('tab', { name: '医生' }).getAttribute('aria-selected')).toBe('true');
  });

  it('jumps to the first and last role tabs with Home and End', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      if (path === '/role-permissions/BOSS') return bossPermissions;
      return {};
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('医生默认模块权限');

    fireEvent.keyDown(screen.getByRole('tab', { name: '医生' }), { key: 'Home' });
    const firstTab = screen.getByRole('tab', { name: '老板' });
    expect(document.activeElement).toBe(firstTab);
    expect(firstTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(firstTab, { key: 'End' });
    const lastTab = screen.getByRole('tab', { name: '医生' });
    expect(document.activeElement).toBe(lastTab);
    expect(lastTab.getAttribute('aria-selected')).toBe('true');
  });

  it('saves the full module permission set for the active role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      return {};
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('医生默认模块权限');
    fireEvent.click(screen.getByLabelText('患者档案'));
    fireEvent.click(screen.getByText('保存角色权限'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/role-permissions/DOCTOR',
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(await screen.findByText('角色权限已更新')).toBeDefined();
  });

  it('shows loading and error states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<PermissionsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('permissions failed'));
    render(<PermissionsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('reports save failures with the fallback message', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/role-permissions/DOCTOR' && options?.method === 'PUT') {
        throw 'save failed';
      }
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      throw 'save failed';
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('医生默认模块权限');
    fireEvent.click(screen.getByRole('button', { name: '保存角色权限' }));
    expect(await screen.findByText('保存角色权限失败')).toBeDefined();
  });
});
