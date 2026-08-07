import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useAsyncAction } from './use-async-action';
import { useToast } from './toast-context';

const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
};

export function HrWorkflowPage() {
  const { showToast } = useToast();
  const leaves = useQuery({
    queryKey: ['leaves'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/leaveRequests?page=1&pageSize=100'),
  });

  if (leaves.isLoading) return <LoadingState label="请假数据加载中..." />;
  if (leaves.error) {
    return (
      <div className="page">
        <PageError message={leaves.error instanceof Error ? leaves.error.message : String(leaves.error)} />
        <button onClick={() => { void leaves.refetch(); }}>重试</button>
      </div>
    );
  }

  async function approve(id: string, approved: boolean) {
    try {
      await apiRequest(`/hr/leaves/${id}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ approved }),
      });
      showToast(approved ? '已批准' : '已驳回', 'success');
      await leaves.refetch();
    } catch (error) {
      showToast(errorMessage(error, '审批失败'), 'error');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'userId', label: '员工', render: (row) => String(row.userId ?? '') },
    {
      key: 'dates',
      label: '日期',
      render: (row) => `${String(row.startDate ?? '')} - ${String(row.endDate ?? '')}`,
    },
    { key: 'status', label: '状态', render: (row) => LEAVE_STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => <ApproveButtons id={String(row.id)} onDone={approve} />,
    },
  ];

  return (
    <div className="page">
      <h1>人事审批</h1>
      <DataTable
        columns={columns}
        rows={leaves.data?.items.filter((row) => String(row.status) === 'PENDING') ?? []}
        keyField="id"
        emptyText="暂无待审批请假"
      />
    </div>
  );
}

/** 行内审批按钮：busy 期间同时禁用批准/驳回，防止双击重复审批。 */
function ApproveButtons({ id, onDone }: { id: string; onDone: (id: string, approved: boolean) => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  return (
    <>
      <button disabled={busy} onClick={() => run(() => onDone(id, true))}>批准</button>
      <button className="danger" disabled={busy} onClick={() => run(() => onDone(id, false))}>驳回</button>
    </>
  );
}
