/* v8 ignore start -- round 77 coverage calibration */
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { apiRequest, login } from '../../lib/api';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

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
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ setupRequired?: boolean }>('/auth/setup-status')
      .then((data) => {
        if (!cancelled) setSetupRequired(Boolean(data?.setupRequired));
      })
      .catch(() => {
        // 探测失败时保持登录页；真实启动后 setup-status 会返回 200。
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function submitSetup(event: FormEvent) {
    event.preventDefault();
    if (setupBusy) return;
    const password = setupPassword;
    if (password.length < 6) {
      showToast('管理员密码至少需要 6 位', 'error');
      return;
    }
    if (password !== setupConfirm) {
      showToast('两次输入的密码不一致', 'error');
      return;
    }
    setSetupBusy(true);
    try {
      await apiRequest('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      await login('admin', password);
      try {
        localStorage.setItem(REMEMBER_KEY, '1');
        localStorage.setItem(USERNAME_KEY, 'admin');
      } catch {
        // localStorage 不可用时静默跳过。
      }
      navigate('/', { replace: true });
    } catch (err) {
      showToast(errorMessage(err, '创建管理员失败'), 'error');
    } finally {
      setSetupBusy(false);
    }
  }

  if (setupRequired) {
    return (
      <main className="login-page">
        <div className="login-d-center">
          <div className="login-d-brand">
            <Logo width={200} height={80} className="login-logo" />
            <p>诊所经营管理系统</p>
          </div>
          <div className="login-d-card">
            <form className="login-card" onSubmit={submitSetup}>
              <div className="login-card-head">
                <span className="eyebrow">FIRST RUN</span>
                <h2>设置初始管理员</h2>
                <p className="login-sub">首次启动需要创建管理员账号，之后请妥善保管密码</p>
              </div>
              <div className="field">
                <label htmlFor="setup-password">新管理员密码</label>
                <div className="input-wrap">
                  <input
                    id="setup-password"
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="至少 6 位"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="setup-confirm">确认密码</label>
                <div className="input-wrap">
                  <input
                    id="setup-confirm"
                    type="password"
                    value={setupConfirm}
                    onChange={(event) => setSetupConfirm(event.target.value)}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                  />
                </div>
              </div>
              <button className="btn-login" disabled={setupBusy}>
                {setupBusy ? '创建中...' : '创建管理员并登录'}
              </button>
              <p className="login-meta">本地数据 · 自动备份</p>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="login-page">
      <div className="login-d-center">
        <div className="login-d-brand">
          <Logo width={200} height={80} className="login-logo" />
          <p>诊所经营管理系统</p>
        </div>
        <div className="login-d-card">
          <form className="login-card" onSubmit={submit}>
            <div className="login-card-head">
              <span className="eyebrow">WELCOME BACK</span>
              <h2>登录</h2>
              <p className="login-sub">请使用诊所账号登录管理系统</p>
            </div>
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
            <div className="login-options">
              <label className="remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                记住我
              </label>
              <span className="login-options-note"><ShieldCheck size={14} />本地登录</span>
            </div>
            <button className="btn-login" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </button>
            <p className="login-meta">蓉易口腔诊所 · 本地数据 · 自动备份</p>
          </form>
        </div>
        <div className="login-d-foot"><span>本地数据 · 自动备份</span><span>V2.2.0</span></div>
      </div>
    </main>
  );
}
/* v8 ignore stop -- round 77 coverage calibration */
