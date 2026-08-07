import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { login } from './api';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const REMEMBER_KEY = 'ry-remember';
const USERNAME_KEY = 'ry-username';

function rememberedUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function remembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(remembered);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      await login(username, password);
      try {
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, '1');
          localStorage.setItem(USERNAME_KEY, username);
        } else {
          localStorage.removeItem(REMEMBER_KEY);
          localStorage.removeItem(USERNAME_KEY);
        }
      } catch {
        // localStorage 不可用时（隐私模式等）静默跳过，不影响登录
      }
      navigate('/', { replace: true });
    } catch (err) {
      showToast(errorMessage(err, '登录失败'), 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="login-logo" aria-hidden="true" />
        <h1>蓉易口腔诊所</h1>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>登录</h2>
          <p className="login-sub">请使用诊所账号登录管理系统</p>
          <div className="field">
            <label htmlFor="login-username">用户名</label>
            <div className="input-wrap">
              <span className="ic" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                </svg>
              </span>
              <input
                id="login-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="请输入账号"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="login-password">密码</label>
            <div className="input-wrap">
              <span className="ic" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </span>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </div>
          </div>
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            记住我
          </label>
          <button className="btn-login" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
          <p className="login-meta">蓉易口腔诊所 · 管理系统</p>
        </form>
      </div>
    </main>
  );
}
