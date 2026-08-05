import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  CANCELLED: '已取消',
};

type FirstExamRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  status?: string | null;
  chiefComplaint?: string | null;
};

interface FirstExamForm {
  patientId: string;
  doctorId: string;
  consultantId: string;
  status: string;
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  oralExam: string;
  auxiliaryExam: string;
  diagnosis: string;
  treatmentSuggestion: string;
  remark: string;
}

const emptyForm: FirstExamForm = {
  patientId: '',
  doctorId: '',
  consultantId: '',
  status: 'DRAFT',
  chiefComplaint: '',
  presentIllness: '',
  pastHistory: '',
  oralExam: '',
  auxiliaryExam: '',
  diagnosis: '',
  treatmentSuggestion: '',
  remark: '',
};

export function FirstExamsPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FirstExamForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const patients = useQuery({
    queryKey: ['first-exam-patients'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=200'),
  });
  const doctors = useQuery({
    queryKey: ['first-exam-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['first-exams'],
    queryFn: () => apiRequest<Page<FirstExamRow>>('/resources/firstExams?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting || !form.patientId || !form.doctorId) {
      showToast('请选择患者和医生', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/resources/firstExams', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          doctorId: form.doctorId,
          consultantId: form.consultantId || undefined,
          status: form.status,
          chiefComplaint: form.chiefComplaint || undefined,
          presentIllness: form.presentIllness || undefined,
          pastHistory: form.pastHistory || undefined,
          oralExam: form.oralExam || undefined,
          auxiliaryExam: form.auxiliaryExam || undefined,
          diagnosis: form.diagnosis || undefined,
          treatmentSuggestion: form.treatmentSuggestion || undefined,
          remark: form.remark || undefined,
        }),
      });
      showToast('首诊记录已创建', 'success');
      setShowForm(false);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建首诊失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, status: string) {
    try {
      await apiRequest(`/first-exams/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('首诊状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  const columns = [
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    { key: 'chiefComplaint', label: '主诉' },
    {
      key: 'status',
      label: '状态',
      render: (row: FirstExamRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: FirstExamRow) => (
        <select
          defaultValue=""
          aria-label="变更首诊状态"
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
        <h1>首诊管理</h1>
        <button onClick={() => setShowForm(true)}>新建首诊</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无首诊" />
      )}

      <Dialog open={showForm} title="新建首诊" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <select value={form.patientId} onChange={(event) => setForm((current) => ({ ...current, patientId: event.target.value }))}>
              <option value="">选择患者</option>
              {patients.data?.items.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
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
            会诊医生
            <select value={form.consultantId} onChange={(event) => setForm((current) => ({ ...current, consultantId: event.target.value }))}>
              <option value="">不指定</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
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
            现病史
            <textarea value={form.presentIllness} onChange={(event) => setForm((current) => ({ ...current, presentIllness: event.target.value }))} />
          </label>
          <label>
            既往史
            <textarea value={form.pastHistory} onChange={(event) => setForm((current) => ({ ...current, pastHistory: event.target.value }))} />
          </label>
          <label>
            口腔检查
            <textarea value={form.oralExam} onChange={(event) => setForm((current) => ({ ...current, oralExam: event.target.value }))} />
          </label>
          <label>
            辅助检查
            <textarea value={form.auxiliaryExam} onChange={(event) => setForm((current) => ({ ...current, auxiliaryExam: event.target.value }))} />
          </label>
          <label>
            诊断
            <textarea value={form.diagnosis} onChange={(event) => setForm((current) => ({ ...current, diagnosis: event.target.value }))} />
          </label>
          <label>
            治疗建议
            <textarea value={form.treatmentSuggestion} onChange={(event) => setForm((current) => ({ ...current, treatmentSuggestion: event.target.value }))} />
          </label>
          <label>
            备注
            <textarea value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} />
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
