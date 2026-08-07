import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiRequest } from '../lib/api';
import { LoadingState, PageError } from '../components';
import { formatDateTime } from '../lib/format';
import { useToast } from '../lib/toast-context';
import { statusLabel } from './constants';
import type { PrescriptionRow, PrescriptionStatusResult } from './types';

export function PrescriptionStatusDialog({
  row,
  onClose,
  onChanged,
}: {
  row: PrescriptionRow;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const query = useQuery({
    queryKey: ['prescription-status', row.id],
    queryFn: () => apiRequest<PrescriptionStatusResult>(`/prescriptions/${row.id}/status`),
  });

  async function refresh(): Promise<void> {
    await query.refetch();
    await onChanged();
  }

  if (query.isLoading) return <LoadingState label="状态加载中..." />;
  if (query.error) {
    return (
      <>
        <PageError message={query.error.message} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </>
    );
  }
  const status = query.data;
  return (
    <>
      {status && (
        <dl>
          <dt>状态</dt>
          <dd>{statusLabel(status.status)}</dd>
          <dt>处理时间</dt>
          <dd>{formatDateTime(status.processedAt)}</dd>
          <dt>划价单</dt>
          <dd>{status.chargeId ?? '—'}</dd>
          <dt>领药单</dt>
          <dd>{status.dispenseId ?? '—'}</dd>
        </dl>
      )}
      <div className="modal-actions">
        <button
          type="button"
          onClick={() => {
            void refresh();
            showToast('状态已刷新', 'success');
          }}
        >
          刷新
        </button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </>
  );
}
