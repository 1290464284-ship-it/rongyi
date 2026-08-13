import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DataTable, LoadingState, PageError, PagePager, type DataTableColumn } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';
import { LEAVE_STATUS_LABELS } from '../../lib/labels';

const WORKFLOW_PAGE_SIZE = 100;

export function HrWorkflowPage() {
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const leaves = useQuery({
    queryKey: ['leaves', page],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/leaveRequests?status=PENDING&page=${page}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const stale = leaves.isPlaceholderData;

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
    if (stale) return;
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
      render: (row) => <ApproveButtons id={String(row.id)} onDone={approve} disabled={stale} />,
    },
  ];

  return (
    <div className="page">
      <div className="page-head"><h1>人事审批</h1></div>
      <DataTable
        columns={columns}
        rows={leaves.data?.items ?? []}
        keyField="id"
        emptyText="暂无待审批请假"
      />
      <PagePager
        page={page}
        hasNext={page * WORKFLOW_PAGE_SIZE < (leaves.data?.total ?? 0)}
        onPageChange={setPage}
        disabled={stale}
      />
    </div>
  );
}

/** 行内审批按钮：busy 期间同时禁用批准/驳回，防止双击重复审批。 */
function ApproveButtons({ id, onDone, disabled }: { id: string; onDone: (id: string, approved: boolean) => Promise<void>; disabled?: boolean }) {
  const { busy, run } = useAsyncAction();
  return (
    <>
      <button disabled={busy || disabled} onClick={() => run(() => onDone(id, true))}>批准</button>
      <button className="danger" disabled={busy || disabled} onClick={() => run(() => onDone(id, false))}>驳回</button>
    </>
  );
}
