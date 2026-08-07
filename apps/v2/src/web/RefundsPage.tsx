import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, EmptyState, LoadingState, PageError, type DataTableColumn } from './components';
import { formatDateTime, formatMoney } from './format';
import { errorMessage } from './messages';
import { useAsyncAction } from './use-async-action';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: '待审核',
  PENDING_REFUND: '待退款',
  COMPLETED: '已完成',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
};

const STATUS_ORDER = ['REQUESTED', 'PENDING_REFUND', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;

type RefundAction = 'approve' | 'reject' | 'cancel' | 'process';

interface RefundRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientName?: string | null;
  chargeId?: string | null;
  chargeNumber?: string | null;
  amount?: number | null;
  reason?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

const columns: DataTableColumn<RefundRow>[] = [
  { key: 'patient', label: '患者', render: (row) => row.patientName ?? row.patientId ?? '' },
  { key: 'chargeNumber', label: '收费单号', render: (row) => row.chargeNumber ?? '' },
  { key: 'amount', label: '金额', render: (row) => formatMoney(row.amount) },
  { key: 'reason', label: '原因', render: (row) => row.reason ?? '' },
  {
    key: 'status',
    label: '状态',
    render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
  },
  { key: 'createdAt', label: '申请时间', render: (row) => formatDateTime(row.createdAt) },
];

export function RefundsPage() {
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const summary = useQuery({
    queryKey: ['refunds-summary'],
    queryFn: () => apiRequest<Page<RefundRow>>('/refunds?page=1&pageSize=200'),
    staleTime: 30_000,
  });
  const query = useQuery({
    queryKey: ['refunds', page],
    queryFn: () => apiRequest<Page<RefundRow>>(`/refunds?page=${page}&pageSize=20`),
  });

  if (query.isLoading) return <LoadingState label="退款记录加载中..." />;
  if (query.error) {
    return (
      <div className="page">
        <PageError message={query.error instanceof Error ? query.error.message : String(query.error)} />
        <button onClick={() => void query.refetch()}>重试</button>
      </div>
    );
  }

  const rows = query.data?.items ?? [];
  const withActions: DataTableColumn<RefundRow>[] = [
    ...columns,
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <RefundRowActions
          row={row}
          reload={() => query.refetch()}
          showToast={showToast}
        />
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>退款管理</h1>
      </div>
      <RefundStatusChips rows={summary.data?.items ?? []} />
      {rows.length === 0 ? (
        <EmptyState message="暂无退款记录" />
      ) : (
        <DataTable columns={withActions} rows={rows} keyField="id" emptyText="暂无退款记录" />
      )}
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
        <span>第 {page} 页</span>
        <button disabled={!query.data || page * 20 >= query.data.total} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div>
    </div>
  );
}

function RefundStatusChips({ rows }: { rows: RefundRow[] }) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? '');
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (
    <div className="tracking-overview" aria-label="退款状态汇总">
      {STATUS_ORDER.map((status) => (
        <span className="tracking-chip" key={status}>
          {STATUS_LABELS[status]} {counts.get(status) ?? 0}
        </span>
      ))}
    </div>
  );
}

function RefundRowActions({
  row,
  reload,
  showToast,
}: {
  row: RefundRow;
  reload: () => Promise<unknown>;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  const status = String(row.status ?? '');
  const { busy, run } = useAsyncAction();
  if (status === 'REQUESTED') {
    return (
      <span>
        <button disabled={busy} onClick={() => run(() => transitionRefund(showToast, reload, row.id, 'approve', '退款已通过审批'))}>
          通过审批
        </button>
        <button disabled={busy} onClick={() => run(() => transitionRefund(showToast, reload, row.id, 'reject', '退款已驳回'))}>
          驳回
        </button>
        <button disabled={busy} onClick={() => run(() => transitionRefund(showToast, reload, row.id, 'cancel', '退款已取消'))}>
          取消
        </button>
      </span>
    );
  }
  if (status === 'PENDING_REFUND') {
    return (
      <span>
        <button disabled={busy} onClick={() => run(() => transitionRefund(showToast, reload, row.id, 'process', '退款已完成'))}>
          确认退款
        </button>
      </span>
    );
  }
  return null;
}

async function transitionRefund(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  action: RefundAction,
  successMessage: string,
) {
  try {
    await apiRequest(`/refunds/${id}/${action}`, { method: 'POST' });
    showToast(successMessage, 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '操作失败，请稍后重试'), 'error');
  }
}
