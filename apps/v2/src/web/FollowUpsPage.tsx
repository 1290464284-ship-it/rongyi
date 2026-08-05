import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, downloadCsvPath } from './api';
import { DataTable, PromptDialog, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

type CompletionTarget = { kind: 'single'; id: string } | { kind: 'batch' } | null;

export function FollowUpsPage() {
  const { showToast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<CompletionTarget>(null);
  const query = useQuery({
    queryKey: ['followup-reminders'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/follow-ups/reminders'),
  });
  const summary = useQuery({
    queryKey: ['followup-summary'],
    queryFn: () => apiRequest<{ total: number; overdue: number; today: number; upcoming: number }>('/follow-ups/reminders/summary'),
  });

  async function batchGenerate() {
    try {
      await apiRequest('/follow-ups/batch-generate', { method: 'POST', body: JSON.stringify({ limit: 50 }) });
      showToast('批量生成完成', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '批量生成失败'), 'error');
    }
  }

  async function submitCompletion(resultText: string) {
    const result = resultText.trim() || undefined;
    try {
      if (completion?.kind === 'single') {
        await apiRequest(`/follow-ups/${completion.id}/complete`, {
          method: 'PATCH',
          body: JSON.stringify({ result }),
        });
        showToast('随访已完成', 'success');
        await query.refetch();
      } else if (completion?.kind === 'batch') {
        const data = await apiRequest<{ completed: number; skipped: number; errors: string[] }>(
          '/follow-ups/batch-complete',
          {
            method: 'POST',
            body: JSON.stringify({ ids: selectedIds, result }),
          },
        );
        showToast(`完成 ${data.completed} 条，跳过 ${data.skipped} 条`, 'success');
        setSelectedIds([]);
        await Promise.all([query.refetch(), summary.refetch()]);
      }
    } catch (error) {
      showToast(errorMessage(error, '随访完成操作失败'), 'error');
    } finally {
      setCompletion(null);
    }
  }

  async function exportOverdue() {
    try {
      await downloadCsvPath('/follow-ups/reminders/export?scope=overdue', 'overdue-follow-ups.csv');
    } catch (error) {
      showToast(errorMessage(error, '导出失败'), 'error');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'selected',
      label: '选择',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(String(row.id))}
          onChange={(event) => {
            const id = String(row.id);
            setSelectedIds((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id));
          }}
        />
      ),
    },
    {
      key: 'patient',
      label: '患者',
      render: (row) => String(row.patientName ?? row.patientId ?? ''),
    },
    { key: 'planDate', label: '计划日期', render: (row) => String(row.planDate ?? '') },
    { key: 'status', label: '状态', render: (row) => String(row.status ?? '') },
    { key: 'content', label: '内容', render: (row) => String(row.content ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => <button onClick={() => setCompletion({ kind: 'single', id: String(row.id) })}>完成随访</button>,
    },
  ];

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const rows = query.data ?? [];
  const groups = [
    { title: '已逾期', rows: rows.filter((row) => String(row.planDate ?? '') < todayKey) },
    { title: '今日待随访', rows: rows.filter((row) => String(row.planDate ?? '') === todayKey) },
    { title: '后续待随访', rows: rows.filter((row) => String(row.planDate ?? '') > todayKey) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>随访管理</h1>
        <button onClick={batchGenerate}>批量生成随访</button>
        <button onClick={() => setCompletion({ kind: 'batch' })} disabled={selectedIds.length === 0}>
          批量完成
        </button>
        <button onClick={exportOverdue}>导出逾期</button>
      </div>
      {summary.data && (
        <div className="stat-row">
          <span>总计：{summary.data.total}</span>
          <span>已逾期：{summary.data.overdue}</span>
          <span>今日：{summary.data.today}</span>
          <span>后续：{summary.data.upcoming}</span>
        </div>
      )}
      {rows.length === 0 && <DataTable columns={columns} rows={[]} keyField="id" emptyText="暂无随访" />}
      {groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title} ({group.rows.length})</h2>
          <DataTable columns={columns} rows={group.rows} keyField="id" emptyText="暂无" />
        </section>
      ))}
      <PromptDialog
        key={completion !== null ? 'open' : 'closed'}
        open={completion !== null}
        title="完成随访"
        message="填写完成结果，可选"
        placeholder="例如：已电话回访，患者情况正常"
        confirmText="确认完成"
        onSubmit={(value) => void submitCompletion(value)}
        onCancel={() => setCompletion(null)}
      />
    </div>
  );
}
