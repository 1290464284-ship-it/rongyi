import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '../../lib/api';
import { DataTable, ConfirmDialog, LoadingState, PageError, type DataTableColumn } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

type DatabaseSummary = Record<string, number | string | null>;

const SUMMARY_LABELS: Record<string, string> = {
  Clinic: '诊所',
  User: '员工',
  Patient: '患者',
  Appointment: '预约',
  Charge: '收费单',
  MemberCard: '会员卡',
  InventoryItem: '库存项目',
  FollowUp: '随访',
  PurchaseOrder: '采购单',
  lastPaidAt: '最近收款时间',
};

interface RestoreStagingResult {
  staged?: boolean;
  message: string;
  backupSummary?: DatabaseSummary;
  currentSummary?: DatabaseSummary;
}

function SummaryPanel({ label, summary }: { label: string; summary?: DatabaseSummary }) {
  if (!summary) return <div><h2>{label}</h2><p>暂无摘要</p></div>;
  return (
    <div>
      <h2>{label}</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {Object.entries(summary).map(([key, value]) => (
              <tr key={key}>
                <th>{SUMMARY_LABELS[key] ?? key}</th>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BackupsPage() {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<{ backup?: DatabaseSummary; current?: DatabaseSummary } | null>(null);
  // L6：暂存恢复 / 清理备份走统一 ConfirmDialog（danger 样式），替代原生 window.confirm
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const query = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/backups'),
  });

  if (query.isLoading) return <LoadingState label="备份数据加载中..." />;
  if (query.error) {
    return (
      <div className="page">
        <PageError message={query.error instanceof Error ? query.error.message : String(query.error)} />
        <button onClick={() => { void query.refetch(); }}>重试</button>
      </div>
    );
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ filename: string; encrypted: boolean }>('/backups', { method: 'POST' });
      showToast(`备份已创建：${result.filename}${result.encrypted ? '（已加密）' : ''}`, 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建备份失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function verify(filename: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ integrity: string }>(`/backups/${encodeURIComponent(filename)}/verify`);
      showToast(result.integrity === 'ok' ? '备份完整性校验通过' : `备份完整性校验结果：${result.integrity}`, 'success');
    } catch (error) {
      showToast(errorMessage(error, '校验备份失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function stageRestore(filename: string) {
    setRestoreTarget(filename);
  }

  async function confirmStageRestore() {
    const filename = restoreTarget;
    if (!filename || busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<RestoreStagingResult>(`/backups/${encodeURIComponent(filename)}/restore`, {
        method: 'POST',
      });
      setComparison({ backup: result.backupSummary, current: result.currentSummary });
      // 以服务端明确的状态字段判断成功，不再依赖英文文案相等
      showToast(result.staged === true ? '恢复已暂存，重启应用后生效' : result.message, 'success');
    } catch (error) {
      showToast(errorMessage(error, '暂存恢复失败'), 'error');
    } finally {
      setBusy(false);
      setRestoreTarget(null);
    }
  }

  function cleanup() {
    setCleanupOpen(true);
  }

  async function confirmCleanup() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ kept: number; deleted: Array<{ filename: string }> }>('/backups/cleanup', {
        method: 'POST',
        body: JSON.stringify({ maxKeep: 30 }),
      });
      showToast(`保留 ${result.kept} 个，清理 ${result.deleted.length} 个`, 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '清理备份失败'), 'error');
    } finally {
      setBusy(false);
      setCleanupOpen(false);
    }
  }

  const backupColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'filename', label: '文件名', render: (row) => String(row.filename) },
    { key: 'encrypted', label: '已加密', render: (row) => String(Boolean(row.encrypted)) },
    { key: 'fileSize', label: '大小', render: (row) => String(row.fileSize) },
    { key: 'createdAt', label: '创建时间', render: (row) => String(row.createdAt) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <div className="actions">
          <button onClick={() => verify(String(row.filename))}>校验</button>
          <button onClick={() => stageRestore(String(row.filename))}>暂存恢复</button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>数据备份</h1>
        <button onClick={create}>创建备份</button>
        <button onClick={cleanup}>清理备份（保留 30 个）</button>
      </div>
      {comparison && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <SummaryPanel label="备份数据摘要" summary={comparison.backup} />
          <SummaryPanel label="当前数据摘要" summary={comparison.current} />
        </div>
      )}
      <DataTable columns={backupColumns} rows={query.data ?? []} keyField="filename" emptyText="暂无备份" />
      <ConfirmDialog
        open={restoreTarget !== null}
        title="暂存恢复备份"
        message={restoreTarget ? `确认暂存恢复备份“${restoreTarget}”？重启应用后生效。` : ''}
        danger
        onConfirm={() => confirmStageRestore()}
        onCancel={() => setRestoreTarget(null)}
      />
      <ConfirmDialog
        open={cleanupOpen}
        title="清理过期备份"
        message="确认清理过期备份（保留最近 30 个）？此操作不可撤销。"
        danger
        onConfirm={() => confirmCleanup()}
        onCancel={() => setCleanupOpen(false)}
      />
    </div>
  );
}
