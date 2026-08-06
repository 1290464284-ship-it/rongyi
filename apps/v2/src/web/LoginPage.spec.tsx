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
  });

  it('renders login form and signs in', async () => {
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderPage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'ry0801' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin', 'ry0801');
    });
  });

  it('shows login errors', async () => {
    vi.mocked(login).mockRejectedValue(new Error('invalid credentials'));
    renderPage();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('invalid credentials')).toBeDefined();

    vi.mocked(login).mockRejectedValue('boom');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('登录失败')).toBeDefined();
  });
});
