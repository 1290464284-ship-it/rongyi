// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LoginPage } from './LoginPage';
import { apiRequest, login } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn().mockResolvedValue({ setupRequired: false }),
  downloadCsv: vi.fn(),
  login: vi.fn(),
}));

function renderPage() {
  return render(<MemoryRouter><ToastProvider><LoginPage /></ToastProvider></MemoryRouter>);
}

function renderNavigablePage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<ToastProvider><LoginPage /></ToastProvider>} />
        <Route path="/" element={<div>工作台</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(login).mockReset();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ setupRequired: false });
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders login form and signs in', async () => {
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderPage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'v2-test-seed-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin', 'v2-test-seed-password');
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
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'v2-test-seed-password' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '记住我' }));
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin', 'v2-test-seed-password');
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
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'v2-test-seed-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('other', 'v2-test-seed-password');
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

  it('ignores a second submit while login is already in flight', async () => {
    let resolveLogin: ((value: { token: string; user: Record<string, unknown> }) => void) | undefined;
    vi.mocked(login).mockImplementation(
      () => new Promise((resolve) => { resolveLogin = resolve; }),
    );
    const { container } = renderNavigablePage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'v2-test-seed-password' } });
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(login).toHaveBeenCalledTimes(1);
    resolveLogin?.({ token: 't', user: { id: 'u' } });
    expect(await screen.findByText('工作台')).toBeDefined();
  });

  it('shows the first-run setup wizard and creates the initial admin', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ setupRequired: true })
      .mockResolvedValueOnce({ created: true });
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderNavigablePage();
    expect(await screen.findByText('设置初始管理员')).toBeDefined();
    fireEvent.change(screen.getByLabelText('新管理员密码'), { target: { value: 'first-run-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'first-run-123' } });
    fireEvent.click(screen.getByRole('button', { name: '创建管理员并登录' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/auth/setup',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'first-run-123' }) }),
      );
    });
    expect(login).toHaveBeenCalledWith('admin', 'first-run-123');
    expect(await screen.findByText('工作台')).toBeDefined();
  });

  it('rejects mismatched setup passwords', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ setupRequired: true });
    renderNavigablePage();
    await screen.findByText('设置初始管理员');
    fireEvent.change(screen.getByLabelText('新管理员密码'), { target: { value: 'first-run-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'other-456' } });
    fireEvent.click(screen.getByRole('button', { name: '创建管理员并登录' }));
    expect(await screen.findByText('两次输入的密码不一致')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/auth/setup', expect.anything());
  });

  it('rejects a setup password shorter than six characters', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ setupRequired: true });
    renderNavigablePage();
    await screen.findByText('设置初始管理员');
    fireEvent.change(screen.getByLabelText('新管理员密码'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: '创建管理员并登录' }));
    expect(await screen.findByText('管理员密码至少需要 6 位')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/auth/setup', expect.anything());
  });

  it('continues when localStorage writes fail while remembering login', async () => {
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    renderNavigablePage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'v2-test-seed-password' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '记住我' }));
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('工作台')).toBeDefined();
  });

  it('ignores a late setup-status response after unmount', async () => {
    let resolveSetup: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSetup = resolve; }),
    );
    const { unmount } = renderPage();
    unmount();
    resolveSetup({ setupRequired: true });
    await act(async () => {});
  });

  it('ignores a second setup submit while the first is in flight', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ setupRequired: true });
    let resolveSetup: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSetup = resolve; }),
    );
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderNavigablePage();
    await screen.findByText('设置初始管理员');
    fireEvent.change(screen.getByLabelText('新管理员密码'), { target: { value: 'first-run-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'first-run-123' } });
    const form = screen.getByText('创建管理员并登录').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/auth/setup', expect.objectContaining({ method: 'POST' }));
    });
    expect(apiRequest).toHaveBeenCalledTimes(2);
    resolveSetup?.({ created: true });
    expect(await screen.findByText('工作台')).toBeDefined();
  });

  it('falls back to empty credentials when localStorage reads throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('privacy mode');
    });
    renderPage();
    expect((screen.getByLabelText('用户名') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: '记住我' }) as HTMLInputElement).checked).toBe(false);
  });

  it('shows a setup failure toast when creating the admin fails', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ setupRequired: true })
      .mockRejectedValueOnce('setup failed');
    renderNavigablePage();
    await screen.findByText('设置初始管理员');
    fireEvent.change(screen.getByLabelText('新管理员密码'), { target: { value: 'first-run-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'first-run-123' } });
    fireEvent.click(screen.getByRole('button', { name: '创建管理员并登录' }));
    expect(await screen.findByText('创建管理员失败')).toBeDefined();
  });
});
