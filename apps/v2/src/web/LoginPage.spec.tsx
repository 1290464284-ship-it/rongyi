// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './LoginPage';
import { login } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  downloadCsv: vi.fn(),
  login: vi.fn(),
}));

function renderPage() {
  return render(<MemoryRouter><ToastProvider><LoginPage /></ToastProvider></MemoryRouter>);
}

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(login).mockReset();
    localStorage.clear();
  });

  it('renders login form and signs in', async () => {
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderPage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'REDACTED' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin', 'REDACTED');
    });
  });

  it('shows login errors', async () => {
    vi.mocked(login).mockRejectedValue(new Error('invalid credentials'));
    renderPage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(login).mockRejectedValue('boom');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('登录失败')).toBeDefined();
  });

  it('remembers the username when 记住我 is checked', async () => {
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderPage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'REDACTED' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '记住我' }));
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin', 'REDACTED');
    });
    expect(localStorage.getItem('ry-remember')).toBe('1');
    expect(localStorage.getItem('ry-username')).toBe('admin');
  });

  it('does not remember the username when 记住我 is unchecked', async () => {
    localStorage.setItem('ry-remember', '1');
    localStorage.setItem('ry-username', 'admin');
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderPage();
    // 预勾选状态下取消勾选
    fireEvent.click(screen.getByRole('checkbox', { name: '记住我' }));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'REDACTED' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('other', 'REDACTED');
    });
    expect(localStorage.getItem('ry-remember')).toBeNull();
    expect(localStorage.getItem('ry-username')).toBeNull();
  });

  it('pre-fills the remembered username on mount', () => {
    localStorage.setItem('ry-remember', '1');
    localStorage.setItem('ry-username', 'dr-li');
    renderPage();
    expect((screen.getByLabelText('用户名') as HTMLInputElement).value).toBe('dr-li');
    expect((screen.getByRole('checkbox', { name: '记住我' }) as HTMLInputElement).checked).toBe(true);
  });
});
