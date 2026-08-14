import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { DataTable, LoadingState, PageError } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

interface SyncConflictRow extends Record<string, unknown> {
  id: string;
  tableName: string;
  recordId: string;
  deviceId: string;
  localUpdatedAt?: string | null;
  remoteUpdatedAt?: string | null;
  localSnapshot?: Record<string, unknown>;
  remoteSnapshot?: Record<string, unknown>;
}

export function SyncConflictsPage() {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['sync-conflicts'],
    queryFn: () => apiRequest<SyncConflictRow[]>('/sync/conflicts'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const rows = query.data ?? [];

  async function resolve(row: SyncConflictRow, resolution: 'KEEP_LOCAL' | 'KEEP_REMOTE') {
    /* v8 ignore next -- busyId 期间全部解决按钮 disabled（jsdom 不派发 click），双击守卫不可达，防御冗余 */
    if (busyId) return;
    setBusyId(row.id);
    try {
      await apiRequest(`/sync/conflicts/${row.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      showToast(resolution === 'KEEP_LOCAL' ? '已保留本地版本' : '已采用远端版本', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '处理冲突失败'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const columns = [
    { key: 'tableName', label: '数据表' },
    { key: 'recordId', label: '记录' },
    { key: 'deviceId', label: '设备' },
    {
      key: 'localUpdatedAt',
      label: '本地版本时间',
      render: (row: SyncConflictRow) => String(row.localUpdatedAt ?? '').replace('T', ' ').slice(0, 19),
    },
    {
      key: 'remoteUpdatedAt',
      label: '远端版本时间',
      render: (row: SyncConflictRow) => String(row.remoteUpdatedAt ?? '').replace('T', ' ').slice(0, 19),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: SyncConflictRow) => (
        <>
          <button disabled={busyId !== null} onClick={() => void resolve(row, 'KEEP_LOCAL')}>保留本地</button>
          <button disabled={busyId !== null} onClick={() => void resolve(row, 'KEEP_REMOTE')}>采用远端</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>同步冲突</h1>
        <button onClick={() => void query.refetch()}>刷新</button>
      </div>
      <p className="table-muted">多台设备同时修改同一记录时会在这里等待人工处理。</p>
      <DataTable columns={columns} rows={rows} keyField="id" emptyText="暂无待处理冲突" />
    </div>
  );
}
