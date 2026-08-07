import type { ToastKind } from '../lib/toast-context';
import { rejectOrder, reviewAction } from './api';
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
  const reviewStatus = String(row.reviewStatus ?? '');
  if (reviewStatus === 'PENDING') {
    return (
      <button
        disabled={reviewing}
        onClick={() => void reviewAction(showToast, reload, setReviewing, onChanged, row.id, 'submit', '已提交审核')}
      >
        提交审核
      </button>
    );
  }
  if (reviewStatus === 'SUBMITTED') {
    return (
      <span>
        <button
          disabled={reviewing}
          onClick={() => void reviewAction(showToast, reload, setReviewing, onChanged, row.id, 'approve', '已通过审核')}
        >
          通过
        </button>
        <button disabled={reviewing} onClick={() => void rejectOrder(showToast, reload, setReviewing, onChanged, row.id)}>
          驳回
        </button>
      </span>
    );
  }
  if (reviewStatus === 'REJECTED') {
    return (
      <button
        disabled={reviewing}
        onClick={() => void reviewAction(showToast, reload, setReviewing, onChanged, row.id, 'reopen', '已重新提交')}
      >
        重新提交
      </button>
    );
  }
  return null;
}
