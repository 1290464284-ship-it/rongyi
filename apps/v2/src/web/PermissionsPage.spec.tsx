// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionsPage } from './PermissionsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const doctorPermissions = {
  items: [
    { id: 'p1', role: 'DOCTOR', resource: 'patients', permission: 'list', allowed: true },
    { id: 'p2', role: 'DOCTOR', resource: 'charges', permission: 'update', allowed: false },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
};

const receptionPermissions = {
  items: [
    { id: 'p3', role: 'BOSS', resource: 'appointments', permission: 'create', allowed: true },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe('PermissionsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('loads permissions for the active role and refetches when switching tabs', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/rolePermissions?role=DOCTOR&page=1&pageSize=200') return doctorPermissions;
      if (path === '/resources/rolePermissions?role=BOSS&page=1&pageSize=200') return receptionPermissions;
      return { items: [], total: 0, page: 1, pageSize: 20 };
    });
    render(<PermissionsPage />, { wrapper });
    expect(await screen.findByText('patients')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: '老板' }));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/rolePermissions?role=BOSS&page=1&pageSize=200',
    ));
    expect(await screen.findByText('appointments')).toBeDefined();
  });

  it('renders the permission table with allow toggle and delete buttons', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/rolePermissions')) return doctorPermissions;
      return { items: [], total: 0, page: 1, pageSize: 20 };
    });
    render(<PermissionsPage />, { wrapper });
    expect(await screen.findByText('patients')).toBeDefined();
    expect(screen.getByText('charges')).toBeDefined();
    expect(screen.getByRole('button', { name: '允许' })).toBeDefined();
    expect(screen.getByRole('button', { name: '禁止' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(2);
  });

  it('toggles allowed via PATCH with the inverted value', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/rolePermissions')) return doctorPermissions;
      return { items: [], total: 0, page: 1, pageSize: 20 };
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('patients');

    fireEvent.click(screen.getByRole('button', { name: '允许' }));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/rolePermissions/p1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ allowed: false }) }),
    ));
    expect(await screen.findByText('权限已更新')).toBeDefined();
  });

  it('adds a permission via POST with the active role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/rolePermissions')) return doctorPermissions;
      return { items: [], total: 0, page: 1, pageSize: 20 };
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('patients');

    fireEvent.change(screen.getByLabelText('资源名'), { target: { value: 'treatmentPlans' } });
    fireEvent.change(screen.getByLabelText('权限'), { target: { value: 'delete' } });
    fireEvent.click(screen.getByRole('button', { name: '添加权限' }));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/rolePermissions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ role: 'DOCTOR', resource: 'treatmentPlans', permission: 'delete', allowed: true }),
      }),
    ));
    expect(await screen.findByText('权限已添加')).toBeDefined();
  });

  it('deletes a permission via DELETE', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/rolePermissions')) return doctorPermissions;
      return { items: [], total: 0, page: 1, pageSize: 20 };
    });
    render(<PermissionsPage />, { wrapper });
    await screen.findByText('patients');

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/rolePermissions/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    expect(await screen.findByText('权限已删除')).toBeDefined();
  });

  it('shows the empty state when the role has no permissions', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/rolePermissions')) return { items: [], total: 0, page: 1, pageSize: 20 };
      return { items: [], total: 0, page: 1, pageSize: 20 };
    });
    render(<PermissionsPage />, { wrapper });
    expect(await screen.findByText('该角色暂无权限配置')).toBeDefined();
  });
});
