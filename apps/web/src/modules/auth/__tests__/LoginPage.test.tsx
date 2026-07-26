import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock useLogin
const mockMutateAsync = vi.fn();
vi.mock('@/lib/auth', () => ({
  useLogin: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

// Mock useAuthStore
const mockLogin = vi.fn();
vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (selector: (s: { login: () => void }) => unknown) =>
    selector({ login: mockLogin }),
}));

// Mock 导航
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import LoginPage from '../LoginPage';

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage 登录流程', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染标题、用户名与密码输入框', () => {
    renderLogin();
    expect(screen.getByText('登录系统')).toBeInTheDocument();
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument();
  });

  it('用户名为空时提交显示校验错误', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(screen.getByText('请输入用户名')).toBeInTheDocument();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('密码非 4 位数字时显示校验错误', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('用户名'), 'boss');
    await user.type(screen.getByLabelText('密码'), 'abc');
    await user.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(screen.getByText('密码必须是4位数字')).toBeInTheDocument();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('登录成功后调用 login 并跳转到首页', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValue({ user: { id: 'u1', name: 'Boss' } });
    renderLogin();

    await user.type(screen.getByLabelText('用户名'), 'boss');
    await user.type(screen.getByLabelText('密码'), '1234');
    await user.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({ id: 'u1', name: 'Boss' });
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('401 错误时显示"用户名或密码错误"', async () => {
    const user = userEvent.setup();
    const err = { response: { status: 401 } };
    mockMutateAsync.mockRejectedValue(err);
    renderLogin();

    await user.type(screen.getByLabelText('用户名'), 'boss');
    await user.type(screen.getByLabelText('密码'), '0000');
    await user.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(screen.getByText('用户名或密码错误')).toBeInTheDocument();
    });
  });

  it('其他错误时显示"登录失败，请稍后重试"', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockRejectedValue(new Error('network'));
    renderLogin();

    await user.type(screen.getByLabelText('用户名'), 'boss');
    await user.type(screen.getByLabelText('密码'), '1234');
    await user.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(screen.getByText('登录失败，请稍后重试')).toBeInTheDocument();
    });
  });

  it('品牌副标题展示"牙科管家"', () => {
    renderLogin();
    expect(screen.getByText('牙科管家')).toBeInTheDocument();
    expect(screen.getByText('Dental Clinic Management')).toBeInTheDocument();
  });
});
