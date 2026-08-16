import { useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import type { CephalometricRow } from './types';

export function SendWechatDialog({ row, onClose }: { row: CephalometricRow; onClose: () => void }) {
  const { showToast } = useToast();
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    // ref 级 in-flight 守卫：连点发送在 re-render 前也不会重复 POST（非幂等发消息）
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await apiRequest(`/cephalometric/${row.id}/send`, {
        method: 'POST',
        body: JSON.stringify({
          phone: phone.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      showToast('微信已发送', 'success');
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '微信发送失败'), 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <Dialog open title="发送微信" onClose={onClose}>
      <form onSubmit={handleSend}>
        <label>
          手机号（选填）
          <input aria-label="手机号" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="如 13800000000" />
        </label>
        <label>
          发送内容（选填）
          <textarea aria-label="发送内容" value={note} onChange={(event) => setNote(event.target.value)} placeholder="默认为：测量报告已生成，请查收" />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={sending}>{sending ? '发送中...' : '发送'}</button>
        </div>
      </form>
    </Dialog>
  );
}
