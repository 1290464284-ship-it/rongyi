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
    expect(screen.getByLabelText('患者与预约')).toHaveProperty('checked', false);
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

  it('saves the full module permission set for the active role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/role-permissions/DOCTOR') return doctorPermissions;
      return {};
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('医生默认模块权限');
    fireEvent.click(screen.getByLabelText('患者与预约'));
    fireEvent.click(screen.getByText('保存角色权限'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/role-permissions/DOCTOR',
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(await screen.findByText('角色权限已更新')).toBeDefined();
  });
});
