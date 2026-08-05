import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

type VisitRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  startTime?: string | null;
  status?: string | null;
  chiefComplaint?: string | null;
};

interface VisitForm {
  patientId: string;
  doctorId: string;
  startTime: string;
  endTime: string;
  status: string;
  chiefComplaint: string;
  diagnosis: string;
  treatmentPlan: string;
  summary: string;
  nextReminder: string;
}

const emptyForm: VisitForm = {
  patientId: '',
  doctorId: '',
  startTime: '',
  endTime: '',
  status: 'IN_PROGRESS',
  chiefComplaint: '',
  diagnosis: '',
  treatmentPlan: '',
  summary: '',
  nextReminder: '',
};

export function VisitsPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<VisitForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const doctors = useQuery({
    queryKey: ['visit-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['visits'],
    queryFn: () => apiRequest<Page<VisitRow>>('/resources/visits?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting || !form.patientId || !form.doctorId || !form.startTime) {
      showToast('请选择患者、医生并填写开始时间', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/resources/visits', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          doctorId: form.doctorId,
          startTime: new Date(form.startTime).toISOString(),
          endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
          status: form.status,
          chiefComplaint: form.chiefComplaint || undefined,
          diagnosis: form.diagnosis || undefined,
          treatmentPlan: form.treatmentPlan || undefined,
          summary: form.summary || undefined,
          nextReminder: form.nextReminder || undefined,
        }),
      });
      showToast('就诊记录已创建', 'success');
      setShowForm(false);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建就诊失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, status: string) {
    try {
      await apiRequest(`/visits/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('就诊状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  const columns = [
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    {
      key: 'startTime',
      label: '开始时间',
      render: (row: VisitRow) => row.startTime ? new Date(row.startTime).toLocaleString('zh-CN', { hour12: false }) : '',
    },
    { key: 'chiefComplaint', label: '主诉' },
    {
      key: 'status',
      label: '状态',
      render: (row: VisitRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: VisitRow) => (
        <select
          defaultValue=""
          aria-label="变更就诊状态"
          onChange={(event) => event.target.value && transition(row.id, event.target.value)}
        >
          <option value="">变更状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>就诊管理</h1>
        <button onClick={() => setShowForm(true)}>新建就诊</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无就诊" />
      )}

      <Dialog open={showForm} title="新建就诊" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => setForm((current) => ({ ...current, patientId: id }))} ariaLabel="患者" placeholder="选择患者" />
          </label>
          <label>
            医生
            <select value={form.doctorId} onChange={(event) => setForm((current) => ({ ...current, doctorId: event.target.value }))}>
              <option value="">选择医生</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            开始时间
            <input type="datetime-local" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} />
          </label>
          <label>
            结束时间
            <input type="datetime-local" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} />
          </label>
          <label>
            状态
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            主诉
            <textarea value={form.chiefComplaint} onChange={(event) => setForm((current) => ({ ...current, chiefComplaint: event.target.value }))} />
          </label>
          <label>
            诊断
            <textarea value={form.diagnosis} onChange={(event) => setForm((current) => ({ ...current, diagnosis: event.target.value }))} />
          </label>
          <label>
            治疗计划
            <textarea value={form.treatmentPlan} onChange={(event) => setForm((current) => ({ ...current, treatmentPlan: event.target.value }))} />
          </label>
          <label>
            就诊小结
            <textarea value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
          </label>
          <label>
            下次提醒日期
            <input type="date" value={form.nextReminder} onChange={(event) => setForm((current) => ({ ...current, nextReminder: event.target.value }))} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
