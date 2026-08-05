// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UsersPage } from './UsersPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const userList = {
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

describe('UsersPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows permission error for non-boss users', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ role: 'ADMIN' });
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('仅老板可管理员工账号')).toBeDefined();
  });

  it('lists, creates, edits, and resets a user password', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ role: 'BOSS' })
      .mockResolvedValueOnce(userList);
    render(<UsersPage />, { wrapper });
    expect(await screen.findByText('张医生')).toBeDefined();

    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ id: 'u2' })
      .mockResolvedValueOnce({ ...userList, items: [...userList.items, {
        id: 'u2',
        username: 'nurse',
        name: '李护士',
        role: 'NURSE',
        active: true,
      }] });
    fireEvent.click(screen.getByText('新建员工'));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText(/初始密码/), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李护士' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'NURSE' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/admin/users',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(await screen.findByText('员工已创建')).toBeDefined();

    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ id: 'u1' })
      .mockResolvedValueOnce(userList);
    fireEvent.click(screen.getAllByText('编辑')[0]);
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张医生改' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/admin/users/u1',
      expect.objectContaining({ method: 'PATCH' }),
    ));

    vi.mocked(apiRequest).mockResolvedValueOnce({ changed: true });
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
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ role: 'BOSS' })
      .mockResolvedValueOnce(userList);
    render(<UsersPage />, { wrapper });
    await screen.findByText('张医生');

    fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: 'oldpass' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'different' } });
    fireEvent.click(screen.getByText('修改密码'));
    expect(await screen.findByText('两次输入的新密码不一致')).toBeDefined();

    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ changed: true });
    fireEvent.click(screen.getByText('修改密码'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/auth/password',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('密码已修改，请重新登录')).toBeDefined();
  });
});
