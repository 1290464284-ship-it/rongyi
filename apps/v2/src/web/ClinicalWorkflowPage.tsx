import { useState, type FormEvent } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, LoadingState, PageError } from './components';
import { formatDateTime, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const RESOURCE_LABELS: Record<string, string> = {
  registrations: '挂号',
  visits: '就诊',
  firstExams: '首诊',
  treatments: '治疗',
};

const STATUS_LABELS: Record<string, string> = {
  REGISTERED: '已挂号',
  TRIAGED: '已分诊',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  PLANNED: '已计划',
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  NO_SHOW: '未到诊',
  PENDING: '待处理',
};

const transitions: Record<string, Record<string, string[]>> = {
  registrations: {
    REGISTERED: ['TRIAGED', 'IN_PROGRESS', 'CANCELLED'],
    TRIAGED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  },
  visits: {
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  },
  firstExams: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['APPROVED', 'CANCELLED'],
  },
  treatments: {
    PLANNED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  },
};

const resources = ['registrations', 'visits', 'firstExams', 'treatments'] as const;
type ResourcePageQuery = UseQueryResult<Page<Record<string, unknown>>, Error>;

interface TodayData {
  date?: string;
  registrations?: Array<Record<string, unknown>>;
  appointments?: Array<Record<string, unknown>>;
  totals?: { registrations?: number; appointments?: number; inProgressVisits?: number };
}

interface ChargeItemForm {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
}

type RegistrationRow = Record<string, unknown>;

type WorkbenchDialog =
  | { kind: 'charge'; row: RegistrationRow }
  | { kind: 'record'; row: RegistrationRow }
  | { kind: 'followup'; row: RegistrationRow };

function newChargeItem(): ChargeItemForm {
  return { id: crypto.randomUUID(), name: '', category: '', price: '', quantity: '1' };
}

function rowPatientName(row: RegistrationRow): string {
  return String(row.patientName ?? row.patientIdLabel ?? row.patientId ?? '');
}

export function ClinicalWorkflowPage() {
  const { showToast } = useToast();
  const today = useQuery({
    queryKey: ['workbench', 'today'],
    queryFn: () => apiRequest<TodayData>('/workbench/today'),
  });
  const registrations = useQuery({
    queryKey: ['workflow', 'registrations'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/registrations?page=1&pageSize=100'),
  });
  const visits = useQuery({
    queryKey: ['workflow', 'visits'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/visits?page=1&pageSize=100'),
  });
  const firstExams = useQuery({
    queryKey: ['workflow', 'firstExams'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/firstExams?page=1&pageSize=100'),
  });
  const treatments = useQuery({
    queryKey: ['workflow', 'treatments'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/treatments?page=1&pageSize=100'),
  });
  const queries = { registrations, visits, firstExams, treatments } as Record<typeof resources[number], ResourcePageQuery>;
  const [activeDialog, setActiveDialog] = useState<WorkbenchDialog | null>(null);

  if (today.isLoading || Object.values(queries).some((query) => query.isLoading)) return <LoadingState />;
  const firstError = [today, ...Object.values(queries)].find((query) => query.error);
  if (firstError) return <PageError message={(firstError.error as Error).message} />;

  async function transition(resource: string, id: string, status: string) {
    try {
      const endpoint = resource === 'registrations'
        ? `/registrations/${id}/status`
        : resource === 'visits'
          ? `/visits/${id}/status`
          : resource === 'firstExams'
            ? `/first-exams/${id}/status`
            : `/treatments/${id}/status`;
      await apiRequest(endpoint, { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast(`${RESOURCE_LABELS[resource]}已更新为${STATUS_LABELS[status] ?? status}`, 'success');
      await queries[resource as typeof resources[number]].refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  function refreshAfterAction() {
    void today.refetch();
    void queries.registrations.refetch();
  }

  return (
    <div className="page">
      <h1>就诊工作台</h1>
      <TodayOverview data={today.data} />
      {resources.map((resource) => {
        const query = queries[resource];
        const rows = query.data?.items ?? [];
        const columns = [
          { key: 'id', label: 'ID', render: (row: Record<string, unknown>) => String(row.id).slice(0, 8) },
          {
            key: 'status',
            label: '状态',
            render: (row: Record<string, unknown>) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
          },
          {
            key: 'actions',
            label: '操作',
            render: (row: Record<string, unknown>) => (
              <>
                {(transitions[resource]?.[String(row.status)] ?? []).map((next) => (
                  <button key={next} onClick={() => transition(resource, String(row.id), next)}>
                    {STATUS_LABELS[next] ?? next}
                  </button>
                ))}
                {resource === 'registrations' && (
                  <>
                    <button onClick={() => setActiveDialog({ kind: 'charge', row })}>划价</button>
                    <button onClick={() => setActiveDialog({ kind: 'record', row })}>病历</button>
                    <button onClick={() => setActiveDialog({ kind: 'followup', row })}>回访</button>
                  </>
                )}
              </>
            ),
          },
        ];
        return (
          <section key={resource}>
            <h2>{RESOURCE_LABELS[resource]}</h2>
            <DataTable columns={columns} rows={rows} keyField="id" emptyText="暂无记录" />
          </section>
        );
      })}
      {activeDialog?.kind === 'charge' && (
        <ChargeDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'record' && (
        <RecordDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'followup' && (
        <FollowUpDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
    </div>
  );
}

function TodayOverview({ data }: { data?: TodayData | null }) {
  const totals = data?.totals ?? { registrations: 0, appointments: 0, inProgressVisits: 0 };
  const registrations = data?.registrations ?? [];
  const appointments = data?.appointments ?? [];
  return (
    <section className="today-overview">
      <h2>今日概览{data?.date ? `（${data.date}）` : ''}</h2>
      <div className="today-stats">
        <div className="today-stat"><strong>{totals.registrations ?? 0}</strong><span>今日挂号</span></div>
        <div className="today-stat"><strong>{totals.appointments ?? 0}</strong><span>今日预约</span></div>
        <div className="today-stat"><strong>{totals.inProgressVisits ?? 0}</strong><span>进行中就诊</span></div>
      </div>
      <div className="today-lists">
        <div className="today-list">
          <h3>今日挂号</h3>
          {registrations.length === 0 ? (
            <div className="table-empty">今日暂无挂号</div>
          ) : (
            <ul>
              {registrations.map((row) => (
                <li key={String(row.id)}>
                  <span>{String(row.patientName ?? row.patientId ?? '')}</span>
                  <span>{String(row.doctorName ?? row.doctorId ?? '未分配医生')}</span>
                  <span>{formatDateTime(row.registeredAt)}</span>
                  <span>{STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="today-list">
          <h3>今日预约</h3>
          {appointments.length === 0 ? (
            <div className="table-empty">今日暂无预约</div>
          ) : (
            <ul>
              {appointments.map((row) => (
                <li key={String(row.id)}>
                  <span>{String(row.patientName ?? row.patientId ?? '')}</span>
                  <span>{String(row.doctorName ?? row.doctorId ?? '未分配医生')}</span>
                  <span>{formatDateTime(row.startTime)}</span>
                  <span>{STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ChargeDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [items, setItems] = useState<ChargeItemForm[]>([newChargeItem()]);
  const [busy, setBusy] = useState(false);
  const patientId = String(row.patientId ?? '');
  const patientName = rowPatientName(row);

  function updateItem(id: string, patch: Partial<ChargeItemForm>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        category: item.category.trim() || 'GENERAL',
        price: toCents(item.price),
        quantity: Number(item.quantity || 0),
      }))
      .filter((item) => item.price > 0 && item.quantity > 0);
    if (!patientId || validItems.length === 0) {
      showToast('请至少填写一条有效收费明细', 'error');
      return;
    }
    setBusy(true);
    try {
      // 注意：/api/v2/charges 的 route-policy 只允许财务角色，医生点击会得到 403 ——
      // 这是既有权限设计，页面只负责把错误 toast 出来，不做绕过。
      await apiRequest('/charges', { method: 'POST', body: JSON.stringify({ patientId, items: validItems }) });
      showToast('划价已提交', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '提交划价失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="划价" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        {items.map((item) => (
          <div className="charge-item" key={item.id}>
            <label>
              项目名称
              <input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} />
            </label>
            <label>
              分类
              <input value={item.category} onChange={(event) => updateItem(item.id, { category: event.target.value })} />
            </label>
            <label>
              单价(元)
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.price}
                onChange={(event) => updateItem(item.id, { price: event.target.value })}
              />
            </label>
            <label>
              数量
              <input
                type="number"
                min="1"
                step="1"
                value={item.quantity}
                onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
              />
            </label>
            <button
              type="button"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
              disabled={items.length === 1}
            >
              删除
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setItems((current) => [...current, newChargeItem()])}>添加明细</button>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交划价</button>
        </div>
      </form>
    </Dialog>
  );
}

function RecordDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const patientId = String(row.patientId ?? '');
  const patientName = rowPatientName(row);
  const doctors = useQuery({
    queryKey: ['workbench', 'doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const [doctorId, setDoctorId] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!doctorId) {
      showToast('请选择医生', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/resources/medicalRecords', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          doctorId,
          category: category || undefined,
          status,
          chiefComplaint: chiefComplaint || undefined,
          diagnosis: diagnosis || undefined,
          treatmentPlan: treatmentPlan || undefined,
          isTemplate: false,
        }),
      });
      showToast('病历已创建', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '创建病历失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="新建病历" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        <label>
          医生
          <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
            <option value="">选择医生</option>
            {doctors.data?.map((doctor) => (
              <option key={String(doctor.id)} value={String(doctor.id)}>{String(doctor.name ?? doctor.id)}</option>
            ))}
          </select>
        </label>
        <label>
          分类
          <input value={category} onChange={(event) => setCategory(event.target.value)} />
        </label>
        <label>
          状态
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="DRAFT">草稿</option>
            <option value="SUBMITTED">已提交</option>
            <option value="APPROVED">已审核</option>
          </select>
        </label>
        <label>
          主诉
          <textarea value={chiefComplaint} onChange={(event) => setChiefComplaint(event.target.value)} />
        </label>
        <label>
          诊断
          <textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
        </label>
        <label>
          治疗计划
          <textarea value={treatmentPlan} onChange={(event) => setTreatmentPlan(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交病历</button>
        </div>
      </form>
    </Dialog>
  );
}

function FollowUpDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const patientId = String(row.patientId ?? '');
  const patientName = rowPatientName(row);
  const defaultPlanDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [planDate, setPlanDate] = useState(defaultPlanDate);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!planDate) {
      showToast('请选择随访日期', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/resources/followUps', {
        method: 'POST',
        body: JSON.stringify({ patientId, planDate, content: content || undefined, status: 'PENDING' }),
      });
      showToast('回访已创建', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '创建回访失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="新建回访" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        <label>
          随访日期
          <input type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} />
        </label>
        <label>
          内容
          <textarea value={content} onChange={(event) => setContent(event.target.value)} />
        </label>
        <label>
          状态
          <input readOnly value="PENDING" aria-label="状态" />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交回访</button>
        </div>
      </form>
    </Dialog>
  );
}
