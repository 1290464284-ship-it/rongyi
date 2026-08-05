import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

type MedicalRecordRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  category?: string | null;
  diagnosis?: string | null;
  status?: string | null;
};

interface RecordForm {
  patientId: string;
  visitId: string;
  doctorId: string;
  category: string;
  status: string;
  isTemplate: boolean;
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  allergyHistory: string;
  examination: string;
  diagnosis: string;
  treatmentPlan: string;
  teethInvolved: string;
  images: string;
  signature: string;
}

const emptyForm: RecordForm = {
  patientId: '',
  visitId: '',
  doctorId: '',
  category: '',
  status: 'DRAFT',
  isTemplate: false,
  chiefComplaint: '',
  presentIllness: '',
  pastHistory: '',
  allergyHistory: '',
  examination: '',
  diagnosis: '',
  treatmentPlan: '',
  teethInvolved: '',
  images: '',
  signature: '',
};

export function MedicalRecordsPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RecordForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const doctors = useQuery({
    queryKey: ['record-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const visits = useQuery({
    queryKey: ['record-visits'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/visits?page=1&pageSize=100'),
  });
  const query = useQuery({
    queryKey: ['medical-records'],
    queryFn: () => apiRequest<Page<MedicalRecordRow>>('/resources/medicalRecords?page=1&pageSize=50'),
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
      await apiRequest('/resources/medicalRecords', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          visitId: form.visitId || undefined,
          doctorId: form.doctorId,
          category: form.category || undefined,
          status: form.status,
          isTemplate: form.isTemplate,
          chiefComplaint: form.chiefComplaint || undefined,
          presentIllness: form.presentIllness || undefined,
          pastHistory: form.pastHistory || undefined,
          allergyHistory: form.allergyHistory || undefined,
          examination: form.examination || undefined,
          diagnosis: form.diagnosis || undefined,
          treatmentPlan: form.treatmentPlan || undefined,
          teethInvolved: splitList(form.teethInvolved),
          images: splitList(form.images),
          signature: form.signature || undefined,
        }),
      });
      showToast('病历已创建', 'success');
      setShowForm(false);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建病历失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    { key: 'category', label: '分类' },
    { key: 'diagnosis', label: '诊断' },
    { key: 'status', label: '状态' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>病历管理</h1>
        <button onClick={() => setShowForm(true)}>新建病历</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无病历" />
      )}

      <Dialog open={showForm} title="新建病历" onClose={() => setShowForm(false)}>
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
            关联就诊
            <select value={form.visitId} onChange={(event) => setForm((current) => ({ ...current, visitId: event.target.value }))}>
              <option value="">不关联</option>
              {visits.data?.items.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            分类
            <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
          </label>
          <label>
            状态
            <input value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} />
          </label>
          <label>
            <input type="checkbox" checked={form.isTemplate} onChange={(event) => setForm((current) => ({ ...current, isTemplate: event.target.checked }))} />
            作为模板
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
            过敏史
            <textarea value={form.allergyHistory} onChange={(event) => setForm((current) => ({ ...current, allergyHistory: event.target.value }))} />
          </label>
          <label>
            检查所见
            <textarea value={form.examination} onChange={(event) => setForm((current) => ({ ...current, examination: event.target.value }))} />
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
            涉及牙位（逗号分隔）
            <input value={form.teethInvolved} onChange={(event) => setForm((current) => ({ ...current, teethInvolved: event.target.value }))} />
          </label>
          <label>
            图片 URL（逗号分隔）
            <input value={form.images} onChange={(event) => setForm((current) => ({ ...current, images: event.target.value }))} />
          </label>
          <label>
            签名
            <input value={form.signature} onChange={(event) => setForm((current) => ({ ...current, signature: event.target.value }))} />
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

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
