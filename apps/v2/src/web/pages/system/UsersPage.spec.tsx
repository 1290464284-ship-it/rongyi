// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UsersPage } from './UsersPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

interface UserListItem {
  id: string;
  username: string;
  name: string;
  role: string;
  phone?: string;
  active: boolean;
}

const baseUserList: {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
} = {
  items: [{
    id: 'u1',
    username: 'doctor',
    name: '张医生',
    role: 'DOCTOR',
    phone: '13800000000',
    active: true,
  }],
  total: 1,
  page: 1,
  pageSize: 20,
};

const userRoles = { items: [{ userId: 'u1', role: 'BOSS' }] };

describe('UsersPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows permission error for non-boss users', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'DOCTOR' };
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('仅老板或管理员可管理员工账号')).toBeDefined();
  });

  it('lists, creates, edits, and resets a user password', async () => {
    let users = baseUserList;
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return users;
      if (path === '/user-roles') return userRoles;
      if (path === '/admin/users' && options?.method === 'POST') return { id: 'u2' };
      if (path === '/admin/users/u1' && options?.method === 'PATCH') return { id: 'u1' };
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('张医生')).toBeDefined();

    users = {
      ...baseUserList,
      items: [...baseUserList.items, {
        id: 'u2',
        username: 'nurse',
        name: '李护士',
        role: 'DOCTOR',
        active: true,
      }],
    };
    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'DOCTOR' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/admin/users',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(await screen.findByText('员工已创建')).toBeDefined();

    fireEvent.click(screen.getAllByText('编辑')[0]);
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张医生改' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/admin/users/u1',
      expect.objectContaining({ method: 'PATCH' }),
    ));

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return users;
      if (path === '/user-roles') return userRoles;
      if (path === '/admin/users/u1/password' ) return { changed: true };
      return {};
    });
    fireEvent.click(screen.getAllByText('重置密码')[0]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByText('重置'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/admin/users/u1/password',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('密码已重置')).toBeDefined();
  });

  it('changes the current password and validates confirmation', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: 'oldpass' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'different' } });
    fireEvent.click(screen.getByText('修改密码'));
    expect(await screen.findByText('两次输入的新密码不一致')).toBeDefined();

    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass' } });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/auth/password') return { changed: true };
      return {};
    });
    fireEvent.click(screen.getByText('修改密码'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/auth/password',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('密码已修改，请重新登录')).toBeDefined();
  });

  it('renders additional role badges next to the primary role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') {
        return { items: [{ userId: 'u1', role: 'BOSS' }, { userId: 'u1', role: 'DOCTOR' }] };
      }
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('张医生')).toBeDefined();
    expect(screen.getByText('老板')).toBeDefined();
  });

  it('checks additional roles on create and submits them via PUT', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/admin/users' && options?.method === 'POST') return { id: 'u2' };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'DOCTOR' } });
    fireEvent.click(screen.getByLabelText('老板'));
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/user-roles/u2',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ roles: ['BOSS'] }) }),
    ));
    expect(await screen.findByText('员工已创建')).toBeDefined();
  });

  it('creates another admin from the employee form', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/admin/users' && options?.method === 'POST') return { id: 'u3' };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin2' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '第二管理员' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/admin/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'admin2',
          password: 'password1',
          name: '第二管理员',
          role: 'ADMIN',
          active: true,
        }),
      }),
    ));
    expect(await screen.findByText('员工已创建')).toBeDefined();
  });

  it('keeps BOSS accounts out of ADMIN management controls', async () => {
    const bossList = {
      ...baseUserList,
      items: [{ id: 'boss', username: 'boss', name: '老板', role: 'BOSS', active: true }],
    };
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'ADMIN' };
      if (path === '/resources/users?page=1&pageSize=100') return bossList;
      if (path === '/user-roles') return { items: [] };
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('老板账号')).toBeDefined();
    expect(screen.queryByText('编辑')).toBeNull();
    fireEvent.click(screen.getByText('新建员工'));
    const roleSelect = screen.getByLabelText('角色') as HTMLSelectElement;
    expect([...roleSelect.options].map((option) => option.value)).not.toContain('BOSS');
  });

  it('echoes stored additional roles when editing a user', async () => {
    const bossUserList = {
      ...baseUserList,
      items: [{ ...baseUserList.items[0], role: 'BOSS' }],
    };
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return bossUserList;
      if (path === '/user-roles') return { items: [{ userId: 'u1', role: 'DOCTOR' }] };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getAllByText('编辑')[0]);
    expect(screen.getByLabelText('医生')).toHaveProperty('checked', true);
  });

  it('loads and saves per-user module permissions', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/user-permissions/u1' && (options === undefined || options.method === 'GET')) return { effective: ['finance'] };
      if (path === '/user-permissions/u1' && options?.method === 'PUT') return {};
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getByText('权限'));
    expect(await screen.findByText('设置「张医生」的权限')).toBeDefined();
    expect(screen.getByLabelText('收费财务')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByLabelText('经营分析'));
    fireEvent.click(screen.getByText('保存权限'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/user-permissions/u1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/user-permissions/u1' && (options as RequestInit)?.method === 'PUT',
    );
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body)) as { permissions: Array<{ permission: string; allowed: boolean }> };
    expect(body.permissions.find((item) => item.permission === 'finance')?.allowed).toBe(true);
    expect(body.permissions.find((item) => item.permission === 'analytics')?.allowed).toBe(true);
    expect(await screen.findByText('用户权限已更新')).toBeDefined();
  });

  it('does not delete a user when the confirmation is cancelled', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('取消'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith(
      '/admin/users/u1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows loading and error states for the user list', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') throw new Error('Load failed');
      if (path === '/user-roles') return { items: [] };
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
  });

  it('reports save failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'POST' && path === '/admin/users') throw new Error('');
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('保存失败')).toBeDefined();
  });

  it('reports delete failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'DELETE' && path === '/admin/users/u1') throw new Error('');
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!);
    expect(await screen.findByText('删除失败')).toBeDefined();
  });

  it('reports password reset failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'PATCH' && path === '/admin/users/u1/password') throw new Error('');
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('重置密码'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByText('重置'));
    expect(await screen.findByText('重置密码失败')).toBeDefined();
  });

  it('reports permission load and save failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/user-permissions/u1' && method === 'GET') throw new Error('');
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('权限'));
    expect(await screen.findByText('加载权限失败')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText('设置「张医生」的权限')).toBeNull();
    });

    cleanup();
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/user-permissions/u1' && method === 'GET') return { effective: [] };
      if (path === '/user-permissions/u1' && method === 'PUT') throw new Error('');
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('权限'));
    await screen.findByText('设置「张医生」的权限');
    fireEvent.click(screen.getByText('保存权限'));
    expect(await screen.findByText('保存权限失败')).toBeDefined();
  });

  it('renders unknown roles with a fallback label', async () => {
    const customList = {
      ...baseUserList,
      items: [{ id: 'u9', username: 'custom', name: '自定义', role: 'CUSTOM', active: true }],
    };
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return customList;
      if (path === '/user-roles') return { items: [] };
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('自定义')).toBeDefined();
    expect(screen.getByText('CUSTOM')).toBeDefined();
  });

  it('deletes a user after confirmation and refreshes the list', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'DELETE' && path === '/admin/users/u1') return { deleted: true };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('员工已删除')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/users?page=1&pageSize=100');
    });
  });

  it('fills every field when creating a user and cancels dialogs', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'POST' && path === '/admin/users') return { id: 'u2' };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'ADMIN' } });
    fireEvent.change(screen.getByLabelText('电话'), { target: { value: '13900000000' } });
    fireEvent.click(screen.getByLabelText('老板'));
    fireEvent.click(screen.getByLabelText('老板'));
    fireEvent.click(screen.getByLabelText('医生'));
    fireEvent.click(screen.getByLabelText('启用账号'));
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/admin/users');
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as Record<string, unknown>;
      expect(body.phone).toBe('13900000000');
      expect(body.active).toBe(false);
    });
    expect(await screen.findByText('员工已创建')).toBeDefined();

    fireEvent.click(screen.getAllByText('编辑')[0]);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('cancels the permission and password dialogs', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/user-permissions/u1') return { effective: [] };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.click(screen.getByText('权限'));
    const permissionDialog = await screen.findByRole('dialog');
    fireEvent.keyDown(permissionDialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('设置「张医生」的权限')).toBeNull();
    });

    fireEvent.click(screen.getByText('权限'));
    await screen.findByText('设置「张医生」的权限');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByText('设置「张医生」的权限')).toBeNull();
    });

    fireEvent.click(screen.getByText('重置密码'));
    const passwordDialog = await screen.findByRole('dialog');
    fireEvent.keyDown(passwordDialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('输入新密码，至少 6 位')).toBeNull();
    });
  });

  it('ignores a duplicate user submit while busy', async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'POST' && path === '/admin/users') {
        return await new Promise((resolve) => { resolvePost = resolve; });
      }
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    const dialog = await screen.findByRole('dialog');
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const postCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/admin/users' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    resolvePost?.({ id: 'u2' });
    expect(await screen.findByText('员工已创建')).toBeDefined();
  });

  it('shows the permission error when the current user has no role', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return {};
      return {};
    });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('仅老板或管理员可管理员工账号')).toBeDefined();
  });

  it('prefills sparse users and renders unknown role badges', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') {
        return { items: [{ id: 'u-x', username: 'u-x', name: '无名', role: 'CUSTOM', phone: null, active: true }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/user-roles') return { items: [{ userId: 'u-x', role: 'MYSTERY' }] };
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('无名');
    expect(screen.getByText('MYSTERY')).toBeDefined();
    fireEvent.click(screen.getAllByText('编辑')[0]);
    await waitFor(() => {
      expect((screen.getByLabelText('电话') as HTMLInputElement).value).toBe('');
    });
  });

  it('handles missing user-role data', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') {
        return { items: [{ id: 'u-x', username: 'u-x', name: '无名', role: 'CUSTOM', active: true }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/user-roles') return {};
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('无名');
    fireEvent.click(screen.getAllByText('编辑')[0]);
    expect(await screen.findByRole('dialog')).toBeDefined();
  });

  it('omits phone when creating a user without one', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      const method = String(options?.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (method === 'POST' && path === '/admin/users') return { id: 'u2' };
      if (method === 'PUT' && path === '/user-roles/u2') return {};
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/admin/users');
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as Record<string, unknown>;
      expect(body.phone).toBeUndefined();
    });
  });

  it('opens permissions with missing effective data as all unchecked', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { role: 'BOSS' };
      if (path === '/resources/users?page=1&pageSize=100') return baseUserList;
      if (path === '/user-roles') return userRoles;
      if (path === '/user-permissions/u1') return {};
      return {};
    });
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');
    fireEvent.click(screen.getByText('权限'));
    expect(await screen.findByText('设置「张医生」的权限')).toBeDefined();
    const dialog = screen.getByRole('dialog');
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes.every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
  });
});
