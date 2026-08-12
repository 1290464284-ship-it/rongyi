import { useRef, useState } from 'react';
import { PromptDialog } from '../components';
import type { ToastKind } from '../lib/toast-context';
import { reviewAction } from './api';
import type { PurchaseRow } from './types';

export function ReviewRowActions({
  row,
  reviewing,
  setReviewing,
  reload,
  showToast,
  onChanged,
}: {
  row: PurchaseRow;
  reviewing: boolean;
  setReviewing: (value: boolean) => void;
  reload: () => Promise<unknown>;
  showToast: (message: string, kind?: ToastKind) => void;
  onChanged: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const busyRef = useRef(false);
  const reviewStatus = String(row.reviewStatus ?? '');

  async function runAction(action: string, successMessage: string, body?: Record<string, unknown>): Promise<void> {
    if (busyRef.current || reviewing) return;
    busyRef.current = true;
    try {
      await reviewAction(showToast, reload, setReviewing, onChanged, row.id, action, successMessage, body);
    } finally {
      busyRef.current = false;
    }
  }

  if (reviewStatus === 'PENDING') {
    return (
      <button
        disabled={reviewing}
        onClick={() => void runAction('submit', '已提交审核')}
      >
        提交审核
      </button>
    );
  }
  if (reviewStatus === 'SUBMITTED') {
    return (
      <>
        <span>
          <button
            disabled={reviewing}
            onClick={() => void runAction('approve', '已通过审核')}
          >
            通过
          </button>
          <button disabled={reviewing} onClick={() => setRejectOpen(true)}>
            驳回
          </button>
        </span>
        <PromptDialog
          key={rejectOpen ? 'open' : 'closed'}
          open={rejectOpen}
          title="驳回采购单"
          message="请输入驳回原因"
          value=""
          placeholder="驳回原因"
          confirmText="确认驳回"
          cancelText="取消"
          onSubmit={(reason) => {
            if (!reason.trim()) {
              showToast('驳回原因必填', 'error');
              return;
            }
            setRejectOpen(false);
            void runAction('reject', '已驳回', { reason: reason.trim() });
          }}
          onCancel={() => setRejectOpen(false)}
        />
      </>
    );
  }
  if (reviewStatus === 'REJECTED') {
    return (
      <button
        disabled={reviewing}
        onClick={() => void runAction('reopen', '已重新提交')}
      >
        重新提交
      </button>
    );
  }
  return null;
}
