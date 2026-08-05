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
      <form className="login-card" onSubmit={submit}>
        <h1>口腔诊所管理系统</h1>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button disabled={loading}>{loading ? '登录中...' : '登录'}</button>
      </form>
    </main>
  );
}
