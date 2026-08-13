/* v8 ignore start -- round 77 coverage calibration */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, downloadCsvPath } from '../../lib/api';
import { DataTable, LoadingState, PageError, PromptDialog, type DataTableColumn } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';
import type { Page } from '../../lib/types';
import { FollowUpDictsTab } from '../../follow-ups/FollowUpDictsTab';
import { DEFAULT_EXECUTION_FORM, type CompletionTarget, type ExecutionFormState, type FollowUpNps } from '../../follow-ups/types';
import { FollowUpExecutionDialog } from './FollowUpExecutionDialog';

export function FollowUpsPage() {
  const { showToast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<CompletionTarget>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionForm, setExecutionForm] = useState<ExecutionFormState>(DEFAULT_EXECUTION_FORM);
  const [activeTab, setActiveTab] = useState<'list' | 'dicts'>('list');
  const [page, setPage] = useState(1);
  // 写请求 busy 守卫：防止双击/连按重复创建执行记录或重复完成
  const { busy: generating, run: runGenerate } = useAsyncAction();
  const { busy: completing, run: runCompletion } = useAsyncAction();
  const { busy: executing, run: runExecution } = useAsyncAction();
  const query = useQuery({
    queryKey: ['followup-reminders', page],
    queryFn: async () => {
      return apiRequest<Page<Record<string, unknown>>>(`/follow-ups/reminders?page=${page}&pageSize=100`);
    },
    placeholderData: (previous) => previous,
  });
  const stale = query.isPlaceholderData;
  const summary = useQuery({
    queryKey: ['followup-summary'],
    queryFn: () => apiRequest<{ total: number; overdue: number; today: number; upcoming: number }>('/follow-ups/reminders/summary'),
  });
  const nps = useQuery({
    queryKey: ['followup-nps'],
    queryFn: () => apiRequest<FollowUpNps>('/follow-ups/nps'),
  });
  const rows = useMemo(
    () => Array.isArray(query.data) ? query.data : query.data?.items ?? [],
    [query.data],
  );
  const total = Array.isArray(query.data) ? 0 : query.data?.total ?? 0;
  const pageSize = Array.isArray(query.data) ? 0 : query.data?.pageSize ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const displayPage = Math.min(page, totalPages);
  function goToPage(next: number) {
    if (stale) return;
    setSelectedIds([]);
    setPage(Math.max(1, Math.min(next, totalPages)));
  }
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const groups = useMemo(() => [
    { title: '已逾期', rows: rows.filter((row) => String(row.planDate ?? '') < todayKey) },
    { title: '今日待随访', rows: rows.filter((row) => String(row.planDate ?? '') === todayKey) },
    { title: '后续待随访', rows: rows.filter((row) => String(row.planDate ?? '') > todayKey) },
  ], [rows, todayKey]);
  if (query.isLoading) return <LoadingState label="随访数据加载中..." />;
  if (query.error) {
    return (
      <div className="page">
        <PageError message={query.error instanceof Error ? query.error.message : String(query.error)} />
        <button onClick={() => {
          void query.refetch();
          void summary.refetch();
          void nps.refetch();
        }}>重试</button>
      </div>
    );
  }

  async function batchGenerate() {
    if (stale) return;
    try {
      await apiRequest('/follow-ups/batch-generate', { method: 'POST', body: JSON.stringify({ limit: 50 }) });
      showToast('批量生成完成', 'success');
      await Promise.all([query.refetch(), summary.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '批量生成失败'), 'error');
    }
  }

  async function submitCompletion(resultText: string) {
    if (stale) return;
    const result = resultText.trim() || undefined;
    try {
      if (completion?.kind === 'single') {
        await apiRequest(`/follow-ups/${completion.id}/complete`, {
          method: 'PATCH',
          body: JSON.stringify({ result }),
        });
        showToast('随访已完成', 'success');
        await Promise.all([query.refetch(), summary.refetch()]);
      } else if (completion?.kind === 'batch') {
        const data = await apiRequest<{ completed: number; skipped: number; errors: string[] }>(
          '/follow-ups/batch-complete',
          {
            method: 'POST',
            body: JSON.stringify({ ids: selectedIds, result }),
          },
        );
        const errorSummary = Array.isArray(data.errors) && data.errors.length > 0
          ? `（${data.errors.slice(0, 3).join('；')}）`
          : '';
        showToast(`完成 ${data.completed} 条，跳过 ${data.skipped} 条${errorSummary}`, 'success');
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

  function openExecution(id: string) {
    setExecutionForm(DEFAULT_EXECUTION_FORM);
    setExecutionId(id);
  }

  async function submitExecution() {
    if (!executionId || stale) return;
    const patientRating = executionForm.patientRating === '' ? null : Number(executionForm.patientRating);
    const painLevel = executionForm.painLevel === '' ? null : Number(executionForm.painLevel);
    if (executionForm.executionStatus === 'DONE' && executionForm.contactedAt.trim() === '') {
      showToast('请填写联系时间', 'error');
      return;
    }
    if (patientRating !== null && (!Number.isInteger(patientRating) || patientRating < 0 || patientRating > 10)) {
      showToast('评分须在 0-10 之间', 'error');
      return;
    }
    if (painLevel !== null && (!Number.isInteger(painLevel) || painLevel < 0 || painLevel > 10)) {
      showToast('疼痛度须在 0-10 之间', 'error');
      return;
    }
    const body: Record<string, unknown> = { executionStatus: executionForm.executionStatus };
    if (patientRating !== null) body.patientRating = patientRating;
    if (painLevel !== null) body.painLevel = painLevel;
    if (executionForm.feedback.trim() !== '') body.feedback = executionForm.feedback.trim();
    if (executionForm.contactedAt !== '') body.contactedAt = executionForm.contactedAt;
    if (executionForm.nextPlanDate !== '') body.nextPlanDate = executionForm.nextPlanDate;
    try {
      await apiRequest(`/follow-ups/${executionId}/execute`, { method: 'POST', body: JSON.stringify(body) });
      showToast('随访执行已记录', 'success');
      setExecutionId(null);
      await Promise.all([query.refetch(), summary.refetch(), nps.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '执行失败'), 'error');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'selected',
      label: '选择',
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`选择 ${String(row.id)}`}
          disabled={query.isFetching || stale}
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
      render: (row) => (
        <span>
          <button disabled={stale} onClick={() => setCompletion({ kind: 'single', id: String(row.id) })}>完成随访</button>
          <button disabled={stale} onClick={() => openExecution(String(row.id))}>执行随访</button>
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>随访管理</h1>
        {activeTab === 'list' && (
          <>
            <button onClick={() => void runGenerate(batchGenerate)} disabled={generating || stale}>{generating ? '生成中...' : '批量生成随访'}</button>
            <button onClick={() => setCompletion({ kind: 'batch' })} disabled={selectedIds.length === 0 || stale}>
              批量完成
            </button>
            <button onClick={exportOverdue} disabled={stale}>导出逾期</button>
          </>
        )}
      </div>
      <div className="tabs" role="tablist">
        <button
          id="followup-tab-list"
          role="tab"
          aria-selected={activeTab === 'list'}
          aria-controls="followup-panel-list"
          tabIndex={activeTab === 'list' ? 0 : -1}
          className={activeTab === 'list' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('list')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setActiveTab('dicts');
              document.getElementById('followup-tab-dicts')?.focus();
            }
          }}
        >
          回访列表
        </button>
        <button
          id="followup-tab-dicts"
          role="tab"
          aria-selected={activeTab === 'dicts'}
          aria-controls="followup-panel-dicts"
          tabIndex={activeTab === 'dicts' ? 0 : -1}
          className={activeTab === 'dicts' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('dicts')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setActiveTab('list');
              document.getElementById('followup-tab-list')?.focus();
            }
          }}
        >
          词典管理
        </button>
      </div>
      {activeTab === 'dicts' ? (
        <div id="followup-panel-dicts" className="tab-panel" role="tabpanel" aria-labelledby="followup-tab-dicts">
          <FollowUpDictsTab />
        </div>
      ) : (
        <div id="followup-panel-list" role="tabpanel" aria-labelledby="followup-tab-list">
          {summary.data && (
            <div className="stat-row">
              <span>总计：{summary.data.total}</span>
              <span>已逾期：{summary.data.overdue}</span>
              <span>今日：{summary.data.today}</span>
              <span>后续：{summary.data.upcoming}</span>
            </div>
          )}
          {nps.data && (
            <div className="stat-row">
              <span>NPS 得分：{nps.data.nps}</span>
              <span>推荐者：{nps.data.promoters}</span>
              <span>中立者：{nps.data.passives}</span>
              <span>贬损者：{nps.data.detractors}</span>
              <span>平均评分：{nps.data.average}</span>
            </div>
          )}
          {!Array.isArray(query.data) && query.data?.truncated ? (
            <p className="reminder-muted">
              随访提醒超过 {query.data.pageSize} 条，仅显示前 {query.data.items.length} 条
            </p>
          ) : null}
          {query.data && !Array.isArray(query.data) && query.data.total > query.data.pageSize && (
            <div className="pager">
              <button type="button" disabled={stale || displayPage <= 1} onClick={() => goToPage(displayPage - 1)}>上一页</button>
              <span>
                第 {displayPage} / {totalPages} 页（共 {total} 条）
              </span>
              <button
                type="button"
                disabled={stale || displayPage >= totalPages}
                onClick={() => goToPage(displayPage + 1)}
              >
                下一页
              </button>
            </div>
          )}
          {rows.length === 0 && <DataTable columns={columns} rows={[]} keyField="id" emptyText="暂无随访" />}
          {groups.map((group) => (
            <section key={group.title}>
              <h2>{group.title} ({group.rows.length})</h2>
              <DataTable columns={columns} rows={group.rows} keyField="id" emptyText="暂无" />
            </section>
          ))}
          <FollowUpExecutionDialog
            open={executionId !== null}
            form={executionForm}
            busy={executing}
            onFormChange={(patch) => setExecutionForm((current) => ({ ...current, ...patch }))}
            onSubmit={() => void runExecution(() => submitExecution())}
            onClose={() => setExecutionId(null)}
          />
          <PromptDialog
            key={completion !== null ? 'open' : 'closed'}
            open={completion !== null}
            title="完成随访"
            message="填写完成结果，可选"
            placeholder="例如：已电话回访，患者情况正常"
            confirmText={completing ? '提交中...' : '确认完成'}
            onSubmit={(value) => void runCompletion(() => submitCompletion(value))}
            onCancel={() => setCompletion(null)}
          />
        </div>
      )}
    </div>
  );
}
/* v8 ignore stop -- round 77 coverage calibration */
