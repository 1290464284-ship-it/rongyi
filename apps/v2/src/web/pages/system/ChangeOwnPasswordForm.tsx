import { useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api';
import { errorMessage } from '../../lib/messages';
import type { ToastKind } from '../../lib/toast-context';

export function ChangeOwnPasswordForm({ showToast }: { showToast: (message: string, kind?: ToastKind) => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'error');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await apiRequest('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      showToast('密码已修改，请重新登录', 'success');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      showToast(errorMessage(error, '修改密码失败'), 'error');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <h2>修改我的密码</h2>
      <form className="inline-form" onSubmit={submit}>
        <input type="password" value={oldPassword} placeholder="旧密码" aria-label="旧密码" onChange={(event) => setOldPassword(event.target.value)} />
        <input type="password" value={newPassword} placeholder="新密码" aria-label="新密码" onChange={(event) => setNewPassword(event.target.value)} />
        <input type="password" value={confirmPassword} placeholder="确认新密码" aria-label="确认新密码" onChange={(event) => setConfirmPassword(event.target.value)} />
        <button type="submit" disabled={submitting}>修改密码</button>
      </form>
    </>
  );
}
