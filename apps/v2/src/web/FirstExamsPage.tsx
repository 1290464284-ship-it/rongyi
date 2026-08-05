import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, SearchableSelect, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  CANCELLED: '已取消',
};

const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  NONE: '未追踪',
  PENDING: '待跟进',
  HORIZONTAL_SHOULD: '需横向转诊',
  HORIZONTAL_DONE: '横向已转',
  LOST: '已流失',
};

interface FirstExamTrackingOverview {
  NONE: number;
  PENDING: number;
  HORIZONTAL_SHOULD: number;
  HORIZONTAL_DONE: number;
  LOST: number;
  total: number;
  dueToday: number;
}

type FirstExamRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  status?: string | null;
  followUpStatus?: string | null;
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
  {
    key: 'followUpStatus',
    label: '追踪状态',
    render: (row) => {
      const value = String(row.followUpStatus ?? 'NONE');
      return FOLLOW_UP_STATUS_LABELS[value] ?? value;
    },
  },
];

export function FirstExamsPage() {
  const { showToast } = useToast();
  const [trackingTarget, setTrackingTarget] = useState<FirstExamRow | null>(null);
  const overviewQuery = useQuery({
    queryKey: ['first-exams-tracking-overview'],
    queryFn: () => apiRequest<FirstExamTrackingOverview>('/first-exams/tracking-overview'),
  });
  return (
    <>
      <TrackingOverviewBar data={overviewQuery.data} />
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
          <>
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
            <button onClick={() => setTrackingTarget(row)}>追踪</button>
            {trackingTarget?.id === row.id && (
              <TrackingDialog
                row={row}
                reload={ctx.reload}
                refetchOverview={() => void overviewQuery.refetch()}
                onClose={() => setTrackingTarget(null)}
              />
            )}
          </>
        )}
        renderForm={(ctx) => <FirstExamFormFields form={ctx.form} update={ctx.update} />}
      />
    </>
  );
}

function TrackingOverviewBar({ data }: { data?: FirstExamTrackingOverview }) {
  return (
    <div className="tracking-overview" aria-label="追踪概览">
      <span className="tracking-chip">待跟进 {data?.PENDING ?? 0}</span>
      <span className="tracking-chip">需横向转诊 {data?.HORIZONTAL_SHOULD ?? 0}</span>
      <span className="tracking-chip">横向已转 {data?.HORIZONTAL_DONE ?? 0}</span>
      <span className="tracking-chip">已流失 {data?.LOST ?? 0}</span>
      <span className="tracking-chip">今日应跟进 {data?.dueToday ?? 0}</span>
    </div>
  );
}

interface TrackingForm {
  followUpStatus: string;
  lossReasonType: string;
  lossReason: string;
  nextFollowUpAt: string;
  trackingNote: string;
}

function TrackingDialog({
  row,
  reload,
  refetchOverview,
  onClose,
}: {
  row: FirstExamRow;
  reload: () => Promise<unknown>;
  refetchOverview: () => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<TrackingForm>({
    followUpStatus: String(row.followUpStatus ?? 'NONE'),
    lossReasonType: '',
    lossReason: '',
    nextFollowUpAt: '',
    trackingNote: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const update = (patch: Partial<TrackingForm>) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest(`/first-exams/${row.id}/tracking`, {
        method: 'PATCH',
        body: JSON.stringify({
          followUpStatus: form.followUpStatus,
          lossReasonType: form.lossReasonType || undefined,
          lossReason: form.lossReason || undefined,
          nextFollowUpAt: form.nextFollowUpAt || undefined,
          trackingNote: form.trackingNote || undefined,
        }),
      });
      showToast('追踪状态已更新', 'success');
      await reload();
      refetchOverview();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '更新失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const needsLossReason = form.followUpStatus === 'LOST';
  const needsNextFollowUp = form.followUpStatus === 'PENDING' || form.followUpStatus === 'HORIZONTAL_SHOULD';

  return (
    <Dialog open title="首诊追踪" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label>
          追踪状态
          <select
            aria-label="追踪状态"
            value={form.followUpStatus}
            onChange={(event) => update({ followUpStatus: event.target.value })}
          >
            {Object.entries(FOLLOW_UP_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {needsLossReason && (
          <>
            <label>
              流失原因类型
              <input
                aria-label="流失原因类型"
                value={form.lossReasonType}
                onChange={(event) => update({ lossReasonType: event.target.value })}
                placeholder="如 COST / TRUST / TIME / OTHER 或自由文本"
              />
            </label>
            <label>
              流失原因
              <textarea aria-label="流失原因" value={form.lossReason} onChange={(event) => update({ lossReason: event.target.value })} />
            </label>
          </>
        )}
        {needsNextFollowUp && (
          <label>
            下次跟进日期
            <input
              type="date"
              aria-label="下次跟进日期"
              value={form.nextFollowUpAt}
              onChange={(event) => update({ nextFollowUpAt: event.target.value })}
            />
          </label>
        )}
        <label>
          追踪备注
          <textarea aria-label="追踪备注" value={form.trackingNote} onChange={(event) => update({ trackingNote: event.target.value })} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </Dialog>
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
