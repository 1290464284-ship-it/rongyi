import { useState, type FormEvent } from 'react';
import type { ReactNode } from 'react';
import { apiRequest } from '../lib/api';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';

export function SignForm({
  planId,
  onClose,
  onSigned,
}: {
  planId: string;
  onClose: () => void;
  onSigned: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const [signature, setSignature] = useState('');
  const [signerName, setSignerName] = useState('');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!signature.trim() || !signerName.trim()) {
      showToast('请填写签名与签署人姓名', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/treatment-plans/${planId}/sign`, {
        method: 'POST',
        body: JSON.stringify({
          signature: signature.trim(),
          signerName: signerName.trim(),
          remark: remark.trim() || undefined,
        }),
      });
      showToast('签署完成', 'success');
      await onSigned();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '签署失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        签名图片
        <textarea
          aria-label="签名 dataURL"
          placeholder="粘贴签名图片 dataURL"
          value={signature}
          onChange={(event) => setSignature(event.target.value)}
        />
      </label>
      <label>
        签署人姓名
        <input aria-label="签署人姓名" value={signerName} onChange={(event) => setSignerName(event.target.value)} />
      </label>
      <label>
        备注
        <textarea aria-label="签名备注" value={remark} onChange={(event) => setRemark(event.target.value)} />
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={submitting}>{submitting ? '签署中...' : '签署'}</button>
      </div>
    </form>
  );
}
