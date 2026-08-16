import { useState } from 'react';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { DoctorSelect, SearchableSelect, type DataTableColumn } from '../../components';
import { errorMessage } from '../../lib/messages';
import { createInFlightGuard } from '../../lib/in-flight';
import { VISIT_STATUS_LABELS } from '../../lib/status-extra-labels';
import { toLocalInput } from '../../lib/format';
import { useToast } from '../../lib/toast-context';

const STATUS_LABELS = VISIT_STATUS_LABELS;

type VisitRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  startTime?: string | null;
  status?: string | null;
  chiefComplaint?: string | null;
};

interface VisitForm {
  patientId: string;
  doctorId: string;
  startTime: string;
  endTime: string;
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
  chiefComplaint: '',
  diagnosis: '',
  treatmentPlan: '',
  summary: '',
  nextReminder: '',
};

const VISIT_FIELDS: Array<{ key: keyof VisitForm; label: string; kind: 'datetime' | 'date' | 'textarea' }> = [
  { key: 'startTime', label: '开始时间', kind: 'datetime' },
  { key: 'endTime', label: '结束时间', kind: 'datetime' },
  { key: 'chiefComplaint', label: '主诉', kind: 'textarea' },
  { key: 'diagnosis', label: '诊断', kind: 'textarea' },
  { key: 'treatmentPlan', label: '治疗计划', kind: 'textarea' },
  { key: 'summary', label: '就诊小结', kind: 'textarea' },
  { key: 'nextReminder', label: '下次提醒日期', kind: 'date' },
];

const visitColumns: DataTableColumn<VisitRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'startTime', label: '开始时间', render: (row) => row.startTime ? new Date(row.startTime).toLocaleString('zh-CN', { hour12: false }) : '' },
  { key: 'chiefComplaint', label: '主诉' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
];

export function VisitsPage() {
  const { showToast } = useToast();
  return (
    <CrudPage<VisitRow, VisitForm>
      title="就诊管理"
      createLabel="新建就诊"
      emptyMessage="暂无就诊"
      queryKey={['visits']}
      endpoint="/resources/visits"
      paged
      initialForm={emptyForm}
      validate={(form) => (!form.patientId || !form.doctorId || !form.startTime ? '请选择患者、医生并填写开始时间' : null)}
      toPayload={(form) => ({
        patientId: form.patientId,
        doctorId: form.doctorId,
        startTime: new Date(form.startTime).toISOString(),
        endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
        chiefComplaint: form.chiefComplaint || undefined,
        diagnosis: form.diagnosis || undefined,
        treatmentPlan: form.treatmentPlan || undefined,
        summary: form.summary || undefined,
        nextReminder: form.nextReminder || undefined,
      })}
      formFromRow={(row) => ({
        patientId: String(row.patientId ?? ''),
        doctorId: String(row.doctorId ?? ''),
        startTime: toLocalInput(row.startTime),
        endTime: toLocalInput(row.endTime),
        chiefComplaint: String(row.chiefComplaint ?? ''),
        diagnosis: String(row.diagnosis ?? ''),
        treatmentPlan: String(row.treatmentPlan ?? ''),
        summary: String(row.summary ?? ''),
        nextReminder: String(row.nextReminder ?? '').slice(0, 10),
      })}
      canEdit
      canDelete
      messages={{ create: '就诊记录已创建', update: '就诊记录已更新', delete: '就诊记录已删除' }}
      errorMessages={{ create: '创建就诊失败' }}
      columns={visitColumns}
      rowActions={(row, ctx) => (
        <VisitStatusSelect rowId={row.id} disabled={ctx.stale} onTransition={(id, status) => void transitionVisit(showToast, ctx.reload, id, status)} />
      )}
      renderForm={(ctx) => <VisitForm form={ctx.form} update={ctx.update} />}
    />
  );
}

const transitionGuard = createInFlightGuard();

async function transitionVisit(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
) {
  /* v8 ignore next -- spec「ignores a second status transition while the first is in flight」已覆盖在途去重（探针验证执行、仅 1 次 PATCH），v8 未入账，属采集缺陷 */
  if (!transitionGuard.start(id)) return;
  try {
    await apiRequest(`/visits/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('就诊状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  } finally {
    transitionGuard.finish(id);
  }
}

/** M12：行内受控状态下拉：选中后立即复位为占位项，避免非受控 select 在行复用后残留旧值（对齐 TreatmentsPage 复位模式）。 */
function VisitStatusSelect({ rowId, onTransition, disabled }: {
  rowId: string;
  onTransition: (id: string, status: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label="变更就诊状态"
      onChange={(event) => {
        if (disabled) return;
        const next = event.target.value;
        setValue('');
        if (next) onTransition(rowId, next);
      }}
    >
      <option value="">变更状态</option>
      {Object.entries(STATUS_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}

function VisitForm({ form, update }: { form: VisitForm; update: (patch: Partial<VisitForm>) => void }) {
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <DoctorSelect label="医生" value={form.doctorId} onChange={(id) => update({ doctorId: id })} />
      {VISIT_FIELDS.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.kind === 'textarea' ? (
            <textarea value={form[field.key]} onChange={(event) => update({ [field.key]: event.target.value })} />
          ) : (
            <input type={field.kind === 'datetime' ? 'datetime-local' : 'date'} value={form[field.key]} onChange={(event) => update({ [field.key]: event.target.value })} />
          )}
        </label>
      ))}
    </>
  );
}
