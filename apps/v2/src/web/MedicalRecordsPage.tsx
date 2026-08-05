import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';
import type { Page } from './types';

interface MedicalRecordRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  category?: string | null;
  diagnosis?: string | null;
  status?: string | null;
}

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

const recordColumns: DataTableColumn<MedicalRecordRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'category', label: '分类' },
  { key: 'diagnosis', label: '诊断' },
  { key: 'status', label: '状态' },
];

export function MedicalRecordsPage() {
  return (
    <CrudPage<MedicalRecordRow, RecordForm>
      title="病历管理"
      createLabel="新建病历"
      emptyMessage="暂无病历"
      queryKey={['medical-records']}
      endpoint="/resources/medicalRecords"
      initialForm={emptyForm}
      validate={(form) => (!form.patientId || !form.doctorId ? '请选择患者和医生' : null)}
      toPayload={(form) => ({
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
      })}
      messages={{ create: '病历已创建' }}
      errorMessages={{ create: '创建病历失败' }}
      columns={recordColumns}
      renderForm={(ctx) => <RecordFormFields form={ctx.form} update={ctx.update} />}
    />
  );
}

function RecordFormFields({ form, update }: { form: RecordForm; update: (patch: Partial<RecordForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['record-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const visits = useQuery({
    queryKey: ['record-visits'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/visits?page=1&pageSize=100'),
  });
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        关联就诊
        <select value={form.visitId} onChange={(event) => update({ visitId: event.target.value })}>
          <option value="">不关联</option>
          {visits.data?.items.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        分类
        <input value={form.category} onChange={(event) => update({ category: event.target.value })} />
      </label>
      <label>
        状态
        <input value={form.status} onChange={(event) => update({ status: event.target.value })} />
      </label>
      <label>
        <input type="checkbox" checked={form.isTemplate} onChange={(event) => update({ isTemplate: event.target.checked })} />
        作为模板
      </label>
      <label>
        主诉
        <textarea value={form.chiefComplaint} onChange={(event) => update({ chiefComplaint: event.target.value })} />
      </label>
      <label>
        现病史
        <textarea value={form.presentIllness} onChange={(event) => update({ presentIllness: event.target.value })} />
      </label>
      <label>
        既往史
        <textarea value={form.pastHistory} onChange={(event) => update({ pastHistory: event.target.value })} />
      </label>
      <label>
        过敏史
        <textarea value={form.allergyHistory} onChange={(event) => update({ allergyHistory: event.target.value })} />
      </label>
      <label>
        检查所见
        <textarea value={form.examination} onChange={(event) => update({ examination: event.target.value })} />
      </label>
      <label>
        诊断
        <textarea value={form.diagnosis} onChange={(event) => update({ diagnosis: event.target.value })} />
      </label>
      <label>
        治疗计划
        <textarea value={form.treatmentPlan} onChange={(event) => update({ treatmentPlan: event.target.value })} />
      </label>
      <label>
        涉及牙位（逗号分隔）
        <input value={form.teethInvolved} onChange={(event) => update({ teethInvolved: event.target.value })} />
      </label>
      <label>
        图片 URL（逗号分隔）
        <input value={form.images} onChange={(event) => update({ images: event.target.value })} />
      </label>
      <label>
        签名
        <input value={form.signature} onChange={(event) => update({ signature: event.target.value })} />
      </label>
    </>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
