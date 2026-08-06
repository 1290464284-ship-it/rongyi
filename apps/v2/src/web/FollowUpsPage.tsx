import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, downloadCsvPath } from './api';
import { ConfirmDialog, DataTable, Dialog, LoadingState, PageError, PromptDialog, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import { useCrudResource } from './use-crud-resource';

const DICT_TYPES = [
  { value: 'TYPE', label: 'TYPE 回访类型' },
  { value: 'PROJECT', label: 'PROJECT 回访项目' },
  { value: 'CONTENT', label: 'CONTENT 回访内容' },
  { value: 'RESULT', label: 'RESULT 回访结果' },
  { value: 'COMMUNICATION', label: 'COMMUNICATION 沟通方式' },
];

const DICT_TYPE_LABELS: Record<string, string> = Object.fromEntries(DICT_TYPES.map((entry) => [entry.value, entry.label]));

type CompletionTarget = { kind: 'single'; id: string } | { kind: 'batch' } | null;

interface FollowUpNps {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number;
  average: number;
  breakdown: Array<{ rating: number; count: number }>;
}

interface ExecutionFormState {
  executionStatus: string;
  patientRating: string;
  painLevel: string;
  feedback: string;
  contactedAt: string;
  nextPlanDate: string;
}

const DEFAULT_EXECUTION_FORM: ExecutionFormState = {
  executionStatus: 'DONE',
  patientRating: '',
  painLevel: '',
  feedback: '',
  contactedAt: '',
  nextPlanDate: '',
};

interface FollowUpDictForm {
  dictType: string;
  name: string;
  sortOrder: string;
  active: boolean;
  remark: string;
}

function emptyDictForm(): FollowUpDictForm {
  return { dictType: 'TYPE', name: '', sortOrder: '0', active: true, remark: '' };
}

function FollowUpDictsTab() {
  const [dictTypeFilter, setDictTypeFilter] = useState('');
  const crud = useCrudResource<Record<string, unknown>, FollowUpDictForm>({
    queryKey: ['followup-dicts', dictTypeFilter],
    endpoint: '/resources/followUpDicts',
    listPath: `/resources/followUpDicts?page=1&pageSize=200${dictTypeFilter ? `&dictType=${encodeURIComponent(dictTypeFilter)}` : ''}`,
    initialForm: emptyDictForm,
    canEdit: true,
    canDelete: true,
    validate: (form) => (form.name.trim() ? null : '请填写词典项名称'),
    toPayload: (form) => ({
      dictType: form.dictType,
      name: form.name.trim(),
      sortOrder: Number(form.sortOrder) || 0,
      active: form.active,
      remark: form.remark.trim() || undefined,
    }),
    messages: { create: '词典项已创建', update: '词典项已更新', delete: '词典项已删除' },
    errorMessages: { create: '创建词典项失败', update: '更新词典项失败', delete: '删除词典项失败' },
  });

  if (crud.query.isLoading) return <LoadingState label="词典加载中..." />;
  if (crud.query.error) {
    return (
      <>
        <PageError message={crud.query.error instanceof Error ? crud.query.error.message : String(crud.query.error)} />
        <button onClick={() => void crud.query.refetch()}>重试</button>
      </>
    );
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'dictType',
      label: '分类',
      render: (row) => DICT_TYPE_LABELS[String(row.dictType ?? '')] ?? String(row.dictType ?? ''),
    },
    { key: 'name', label: '名称' },
    { key: 'sortOrder', label: '排序', render: (row) => String(row.sortOrder ?? '') },
    { key: 'active', label: '启用', render: (row) => (row.active ? '是' : '否') },
    { key: 'remark', label: '备注', render: (row) => String(row.remark ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button onClick={() => crud.openEdit(row)}>编辑</button>
          <button className="danger" onClick={() => crud.requestDelete(row)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h2>词典管理</h2>
        <button onClick={crud.openCreate}>新建词典项</button>
      </div>
      <select aria-label="词典分类筛选" value={dictTypeFilter} onChange={(event) => setDictTypeFilter(event.target.value)}>
        <option value="">全部分类</option>
        {DICT_TYPES.map((entry) => (
          <option key={entry.value} value={entry.value}>{entry.label}</option>
        ))}
      </select>
      <DataTable columns={columns} rows={crud.rows} keyField="id" emptyText="暂无词典项" />
      <Dialog open={crud.showForm} title={crud.editing ? '编辑词典项' : '新建词典项'} onClose={crud.closeForm}>
        <form onSubmit={crud.submit}>
          <label>
            分类
            <select value={crud.form.dictType} onChange={(event) => crud.updateForm({ dictType: event.target.value })}>
              {DICT_TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label>
            名称
            <input value={crud.form.name} onChange={(event) => crud.updateForm({ name: event.target.value })} />
          </label>
          <label>
            排序
            <input type="number" value={crud.form.sortOrder} onChange={(event) => crud.updateForm({ sortOrder: event.target.value })} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={crud.form.active}
              onChange={(event) => crud.updateForm({ active: event.target.checked })}
            />
            启用
          </label>
          <label>
            备注
            <textarea value={crud.form.remark} onChange={(event) => crud.updateForm({ remark: event.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={crud.closeForm}>取消</button>
            <button type="submit" disabled={crud.submitting}>{crud.submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={crud.deleteTarget !== null}
        title="删除确认"
        message="确定删除该词典项吗？"
        confirmText="确认删除"
        danger
        onConfirm={() => void crud.confirmDelete()}
        onCancel={crud.cancelDelete}
      />
    </>
  );
}

export function FollowUpsPage() {
  const { showToast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<CompletionTarget>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionForm, setExecutionForm] = useState<ExecutionFormState>(DEFAULT_EXECUTION_FORM);
  const [activeTab, setActiveTab] = useState<'list' | 'dicts'>('list');
  const query = useQuery({
    queryKey: ['followup-reminders'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/follow-ups/reminders'),
  });
  const summary = useQuery({
    queryKey: ['followup-summary'],
    queryFn: () => apiRequest<{ total: number; overdue: number; today: number; upcoming: number }>('/follow-ups/reminders/summary'),
  });
  const nps = useQuery({
    queryKey: ['followup-nps'],
    queryFn: () => apiRequest<FollowUpNps>('/follow-ups/nps'),
  });

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

  function openExecution(id: string) {
    setExecutionForm(DEFAULT_EXECUTION_FORM);
    setExecutionId(id);
  }

  async function submitExecution() {
    if (!executionId) return;
    const body: Record<string, unknown> = { executionStatus: executionForm.executionStatus };
    if (executionForm.patientRating !== '') body.patientRating = Number(executionForm.patientRating);
    if (executionForm.painLevel !== '') body.painLevel = Number(executionForm.painLevel);
    if (executionForm.feedback.trim() !== '') body.feedback = executionForm.feedback.trim();
    if (executionForm.contactedAt !== '') body.contactedAt = executionForm.contactedAt;
    if (executionForm.nextPlanDate !== '') body.nextPlanDate = executionForm.nextPlanDate;
    try {
      await apiRequest(`/follow-ups/${executionId}/execute`, { method: 'POST', body: JSON.stringify(body) });
      showToast('随访执行已记录', 'success');
      setExecutionId(null);
      await Promise.all([query.refetch(), nps.refetch()]);
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
          <button onClick={() => setCompletion({ kind: 'single', id: String(row.id) })}>完成随访</button>
          <button onClick={() => openExecution(String(row.id))}>执行随访</button>
        </span>
      ),
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
        {activeTab === 'list' && (
          <>
            <button onClick={batchGenerate}>批量生成随访</button>
            <button onClick={() => setCompletion({ kind: 'batch' })} disabled={selectedIds.length === 0}>
              批量完成
            </button>
            <button onClick={exportOverdue}>导出逾期</button>
          </>
        )}
      </div>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          className={activeTab === 'list' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('list')}
        >
          回访列表
        </button>
        <button
          role="tab"
          className={activeTab === 'dicts' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('dicts')}
        >
          词典管理
        </button>
      </div>
      {activeTab === 'dicts' ? (
        <div className="tab-panel">
          <FollowUpDictsTab />
        </div>
      ) : (
        <>
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
          {rows.length === 0 && <DataTable columns={columns} rows={[]} keyField="id" emptyText="暂无随访" />}
          {groups.map((group) => (
            <section key={group.title}>
              <h2>{group.title} ({group.rows.length})</h2>
              <DataTable columns={columns} rows={group.rows} keyField="id" emptyText="暂无" />
            </section>
          ))}
          <Dialog open={executionId !== null} title="执行随访" onClose={() => setExecutionId(null)}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitExecution();
              }}
            >
              <label>
                执行状态
                <select
                  value={executionForm.executionStatus}
                  onChange={(event) => setExecutionForm((current) => ({ ...current, executionStatus: event.target.value }))}
                >
                  <option value="DONE">DONE 已完成</option>
                  <option value="SKIPPED">SKIPPED 已跳过</option>
                </select>
              </label>
              <label>
                患者评分（0-10）
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={executionForm.patientRating}
                  onChange={(event) => setExecutionForm((current) => ({ ...current, patientRating: event.target.value }))}
                />
              </label>
              <label>
                疼痛度（0-10）
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={executionForm.painLevel}
                  onChange={(event) => setExecutionForm((current) => ({ ...current, painLevel: event.target.value }))}
                />
              </label>
              <label>
                反馈
                <textarea
                  value={executionForm.feedback}
                  onChange={(event) => setExecutionForm((current) => ({ ...current, feedback: event.target.value }))}
                />
              </label>
              <label>
                联系时间
                <input
                  type="datetime-local"
                  value={executionForm.contactedAt}
                  onChange={(event) => setExecutionForm((current) => ({ ...current, contactedAt: event.target.value }))}
                />
              </label>
              <label>
                下次随访日期
                <input
                  type="date"
                  value={executionForm.nextPlanDate}
                  onChange={(event) => setExecutionForm((current) => ({ ...current, nextPlanDate: event.target.value }))}
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setExecutionId(null)}>取消</button>
                <button type="submit">确认执行</button>
              </div>
            </form>
          </Dialog>
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
        </>
      )}
    </div>
  );
}
