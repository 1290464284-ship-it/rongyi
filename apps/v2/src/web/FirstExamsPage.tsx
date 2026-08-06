import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { ConfirmDialog, Dialog, SearchableSelect, type DataTableColumn } from './components';
import { formatDateTime } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import type { Page } from './types';

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

const DENTITION_LABELS: Record<string, string> = {
  DECIDUOUS: '乳牙列',
  PERMANENT: '恒牙列',
  MIXED: '混合牙列',
};

const CHIEF_MARK_LABELS: Record<string, string> = {
  NONE: '无',
  HORIZONTAL_SHOULD: '横向应',
  HORIZONTAL_DONE: '横向做',
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
  dentition?: string | null;
  previousExamId?: string | null;
  restartedAt?: string | null;
};

interface FirstExamToothRow extends Record<string, unknown> {
  id: string;
  examId?: string | null;
  toothNumber?: number | null;
  toothStatus?: string | null;
  isChief?: boolean | null;
  chiefMark?: string | null;
}

interface FirstExamHistoryItem {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  status?: string | null;
  followUpStatus?: string | null;
  dentition?: string | null;
  previousExamId?: string | null;
  restartedAt?: string | null;
  chiefComplaint?: string | null;
  createdAt?: string | null;
}

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
  {
    key: 'dentition',
    label: '牙列',
    render: (row) => DENTITION_LABELS[String(row.dentition ?? '')] ?? String(row.dentition ?? ''),
  },
  {
    key: 'restartedAt',
    label: '重启',
    render: (row) => (row.restartedAt ? `已重启 ${formatDateTime(row.restartedAt)}` : ''),
  },
];

export function FirstExamsPage() {
  const { showToast } = useToast();
  const [dialogTarget, setDialogTarget] = useState<{ kind: 'tracking' | 'teeth' | 'restart' | 'history'; row: FirstExamRow } | null>(null);
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
            <button onClick={() => setDialogTarget({ kind: 'tracking', row })}>追踪</button>
            <select
              defaultValue={String(row.dentition ?? '')}
              aria-label="切换牙列"
              onChange={(event) => {
                if (event.target.value) void changeDentition(showToast, ctx.reload, row.id, event.target.value);
              }}
            >
              <option value="">牙列</option>
              {Object.entries(DENTITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button onClick={() => setDialogTarget({ kind: 'teeth', row })}>牙齿标记</button>
            <button onClick={() => setDialogTarget({ kind: 'restart', row })}>重启检查</button>
            <button onClick={() => setDialogTarget({ kind: 'history', row })}>历史</button>
            {dialogTarget?.kind === 'tracking' && dialogTarget.row.id === row.id && (
              <TrackingDialog
                row={dialogTarget.row}
                reload={ctx.reload}
                refetchOverview={() => void overviewQuery.refetch()}
                onClose={() => setDialogTarget(null)}
              />
            )}
            {dialogTarget?.kind === 'teeth' && dialogTarget.row.id === row.id && (
              <TeethMarkDialog row={dialogTarget.row} reload={ctx.reload} onClose={() => setDialogTarget(null)} />
            )}
            {dialogTarget?.kind === 'restart' && dialogTarget.row.id === row.id && (
              <ConfirmDialog
                open
                title="重启检查"
                message="确定重启该首诊吗？将复制临床内容创建一条新的检查记录（不复制牙齿明细），原记录保留为历史。"
                confirmText="确认重启"
                onConfirm={() => {
                  setDialogTarget(null);
                  void restartFirstExam(showToast, ctx.reload, row.id);
                }}
                onCancel={() => setDialogTarget(null)}
              />
            )}
            {dialogTarget?.kind === 'history' && dialogTarget.row.id === row.id && (
              <HistoryDialog row={dialogTarget.row} onClose={() => setDialogTarget(null)} />
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

async function changeDentition(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  dentition: string,
) {
  try {
    await apiRequest(`/first-exams/${id}/dentition`, {
      method: 'POST',
      body: JSON.stringify({ dentition }),
    });
    showToast('牙列已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '牙列更新失败'), 'error');
  }
}

async function restartFirstExam(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
) {
  try {
    await apiRequest(`/first-exams/${id}/restart`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('首诊已重启', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '重启检查失败'), 'error');
  }
}

function TeethMarkDialog({
  row,
  reload,
  onClose,
}: {
  row: FirstExamRow;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const teethQuery = useQuery({
    queryKey: ['first-exam-teeth', row.id],
    queryFn: () => apiRequest<Page<FirstExamToothRow>>(`/resources/firstExamTeeth?examId=${encodeURIComponent(row.id)}&page=1&pageSize=200`),
  });
  const teeth = teethQuery.data?.items ?? [];

  async function setChiefMark(tooth: FirstExamToothRow, mark: string) {
    const previous = String(tooth.chiefMark ?? 'NONE');
    setMarks((current) => ({ ...current, [tooth.id]: mark }));
    try {
      await apiRequest(`/first-exams/${row.id}/teeth/${tooth.id}/chief-mark`, {
        method: 'POST',
        body: JSON.stringify({ chiefMark: mark }),
      });
      showToast(`牙齿 ${String(tooth.toothNumber ?? tooth.id)} 主诉标记已更新`, 'success');
      await reload();
    } catch (error) {
      setMarks((current) => ({ ...current, [tooth.id]: previous }));
      showToast(errorMessage(error, '主诉标记更新失败'), 'error');
    }
  }

  return (
    <Dialog open title="主诉牙齿标记" onClose={onClose}>
      {teethQuery.isLoading ? (
        <p>加载中...</p>
      ) : teeth.length === 0 ? (
        <p>该首诊暂无牙齿记录</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>牙位</th>
              <th>状态</th>
              <th>主诉标记</th>
            </tr>
          </thead>
          <tbody>
            {teeth.map((tooth) => {
              const toothNumber = String(tooth.toothNumber ?? tooth.id);
              const currentMark = marks[tooth.id] ?? String(tooth.chiefMark ?? 'NONE');
              return (
                <tr key={tooth.id}>
                  <td>{toothNumber}</td>
                  <td>{String(tooth.toothStatus ?? '')}</td>
                  <td>
                    <select
                      aria-label={`牙齿 ${toothNumber} 主诉标记`}
                      value={currentMark}
                      onChange={(event) => void setChiefMark(tooth, event.target.value)}
                    >
                      {Object.entries(CHIEF_MARK_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: FirstExamRow; onClose: () => void }) {
  const historyQuery = useQuery({
    queryKey: ['first-exam-history', row.id],
    queryFn: () => apiRequest<FirstExamHistoryItem[]>(`/first-exams/history?patientId=${encodeURIComponent(String(row.patientId ?? ''))}`),
    enabled: Boolean(row.patientId),
  });
  const items = historyQuery.data ?? [];

  return (
    <Dialog open title="首诊历史" onClose={onClose}>
      {!row.patientId ? (
        <p>该记录缺少患者信息，无法查看历史</p>
      ) : historyQuery.isLoading ? (
        <p>加载中...</p>
      ) : items.length === 0 ? (
        <p>暂无历史记录</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>主诉</th>
              <th>牙列</th>
              <th>状态</th>
              <th>追踪</th>
              <th>重启</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {formatDateTime(item.createdAt)}
                  {item.id === row.id ? '（当前）' : ''}
                </td>
                <td>{item.chiefComplaint ?? ''}</td>
                <td>{DENTITION_LABELS[String(item.dentition ?? '')] ?? String(item.dentition ?? '')}</td>
                <td>{STATUS_LABELS[String(item.status ?? '')] ?? String(item.status ?? '')}</td>
                <td>{FOLLOW_UP_STATUS_LABELS[String(item.followUpStatus ?? 'NONE')] ?? String(item.followUpStatus ?? '')}</td>
                <td>
                  {item.previousExamId
                    ? item.restartedAt
                      ? `已重启 ${formatDateTime(item.restartedAt)}`
                      : `由 ${item.previousExamId} 重启`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
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
