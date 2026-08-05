import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';
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
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
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

const firstExamColumns: DataTableColumn<FirstExamRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'chiefComplaint', label: '主诉' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
];

export function FirstExamsPage() {
  const { showToast } = useToast();
  return (
    <CrudPage<FirstExamRow, FirstExamForm>
      title="首诊管理"
      createLabel="新建首诊"
      emptyMessage="暂无首诊"
      queryKey={['first-exams']}
      endpoint="/resources/firstExams"
      initialForm={emptyForm}
      validate={(form) => (!form.patientId || !form.doctorId ? '请选择患者和医生' : null)}
      toPayload={(form) => ({
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
      })}
      messages={{ create: '首诊记录已创建' }}
      errorMessages={{ create: '创建首诊失败' }}
      columns={firstExamColumns}
      rowActions={(row, ctx) => (
        <select
          defaultValue=""
          aria-label="变更首诊状态"
          onChange={(event) => {
            if (event.target.value) void transitionFirstExam(showToast, ctx.reload, row.id, event.target.value);
          }}
        >
          <option value="">变更状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}
      renderForm={(ctx) => <FirstExamFormFields form={ctx.form} update={ctx.update} />}
    />
  );
}

async function transitionFirstExam(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
) {
  try {
    await apiRequest(`/first-exams/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('首诊状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  }
}

function FirstExamFormFields({ form, update }: { form: FirstExamForm; update: (patch: Partial<FirstExamForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['first-exam-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
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
        会诊医生
        <select value={form.consultantId} onChange={(event) => update({ consultantId: event.target.value })}>
          <option value="">不指定</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        状态
        <select value={form.status} onChange={(event) => update({ status: event.target.value })}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
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
        口腔检查
        <textarea value={form.oralExam} onChange={(event) => update({ oralExam: event.target.value })} />
      </label>
      <label>
        辅助检查
        <textarea value={form.auxiliaryExam} onChange={(event) => update({ auxiliaryExam: event.target.value })} />
      </label>
      <label>
        诊断
        <textarea value={form.diagnosis} onChange={(event) => update({ diagnosis: event.target.value })} />
      </label>
      <label>
        治疗建议
        <textarea value={form.treatmentSuggestion} onChange={(event) => update({ treatmentSuggestion: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
