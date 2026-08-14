// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChangeOwnPasswordForm } from './ChangeOwnPasswordForm';
import { apiRequest } from '../../lib/api';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

describe('ChangeOwnPasswordForm', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('guards against duplicate submits while a change is pending', async () => {
    let resolvePatch: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const showToast = vi.fn();
    render(<ChangeOwnPasswordForm showToast={showToast} />);
    fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass' } });
    const form = screen.getByLabelText('旧密码').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/auth/password');
      expect(calls).toHaveLength(1);
    });
    resolvePatch({ changed: true });
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('密码已修改，请重新登录', 'success');
    });
  });

  it('rejects mismatched new passwords', async () => {
    const showToast = vi.fn();
    render(<ChangeOwnPasswordForm showToast={showToast} />);
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'different' } });
    const form = screen.getByLabelText('旧密码').closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('两次输入的新密码不一致', 'error');
    });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('reports password change failures', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error(''));
    const showToast = vi.fn();
    render(<ChangeOwnPasswordForm showToast={showToast} />);
    fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass' } });
    const form = screen.getByLabelText('旧密码').closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('修改密码失败', 'error');
    });
  });
});
