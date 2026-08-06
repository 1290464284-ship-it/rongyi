import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { login } from './api';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

export function LoginPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      await login(username, password);
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
        <p>洁净口腔 · 专业呵护，让每一次就诊都安心</p>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>登录</h2>
          <p className="login-sub">请使用诊所账号登录管理系统</p>
          <label>
            用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button disabled={loading}>{loading ? '登录中...' : '登录'}</button>
          <p className="login-meta">蓉易口腔诊所 · 管理系统</p>
        </form>
      </div>
    </main>
  );
}
