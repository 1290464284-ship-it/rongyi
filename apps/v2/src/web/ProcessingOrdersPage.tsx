import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { DataTable, Dialog, LoadingState, PageError, SearchableSelect, type DataTableColumn } from './components';
import { formatDateTime, formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import type { Page } from './types';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

const FLOW_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
};

const FLOW_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE'] as const;

interface ProcessingRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  patientIdLabel?: string | null;
  status?: string | null;
  settleStatus?: string | null;
  settledAmount?: number | null;
  settledAt?: string | null;
  totalFee?: number | null;
}

interface ProcessingItemForm {
  id: string;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  status: string;
}

interface ProcessingOrderItemRow extends Record<string, unknown> {
  id: string;
  name?: string | null;
  spec?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  subtotal?: number | null;
  status?: string | null;
}

interface ProcessingOrderForm {
  patientId: string;
  doctorId: string;
  number: string;
  shade: string;
  teethNumbers: string;
  totalFee: string;
  items: ProcessingItemForm[];
}

interface SettleStats {
  unsettled: { count: number; feeTotal: number };
  settled: { count: number; amountTotal: number };
}

type ProcessingStepStatus = (typeof FLOW_STATUSES)[number];

interface ProcessingOrderStepRow extends Record<string, unknown> {
  id: string;
  stepId?: string | null;
  stepName: string;
  status: ProcessingStepStatus;
  sortOrder: number;
  startedAt?: string | null;
  completedAt?: string | null;
  operatorId?: string | null;
  remark?: string | null;
}

interface ProcessingFlowStatRow extends Record<string, unknown> {
  stepId?: string | null;
  stepName: string;
  doneCount: number;
  inProgressCount: number;
}

interface ProcessingFlowStatsData {
  from?: string | null;
  to?: string | null;
  steps: ProcessingFlowStatRow[];
}

const flowStatsColumns: DataTableColumn<ProcessingFlowStatRow>[] = [
  { key: 'stepName', label: '步骤' },
  { key: 'doneCount', label: '完成单数', render: (row) => String(row.doneCount ?? 0) },
  { key: 'inProgressCount', label: '进行中单数', render: (row) => String(row.inProgressCount ?? 0) },
];

function newItem(): ProcessingItemForm {
  return { id: crypto.randomUUID(), name: '', spec: '', quantity: '1', unitPrice: '', subtotal: '', status: 'DRAFT' };
}

function emptyProcessingForm(): ProcessingOrderForm {
  return { patientId: '', doctorId: '', number: '', shade: '', teethNumbers: '', totalFee: '', items: [newItem()] };
}

interface ValidProcessingItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

function buildValidItems(items: ProcessingItemForm[]): ValidProcessingItem[] {
  return items
    .filter((item) => item.name.trim() && item.quantity && item.unitPrice)
    .map((item) => ({
      name: item.name.trim(),
      quantity: Number(item.quantity),
      unitPrice: toCents(item.unitPrice),
    }))
    .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
}

const processingColumns: DataTableColumn<ProcessingRow>[] = [
  { key: 'number', label: '加工单号' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
  { key: 'settleStatus', label: '结算状态', render: (row) => (row.settleStatus === 'SETTLED' ? '已结算' : '未结算') },
  { key: 'settledAmount', label: '结算金额', render: (row) => (row.settledAmount === null || row.settledAmount === undefined ? '—' : formatMoney(row.settledAmount)) },
];

export function ProcessingOrdersPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const editingStatusRef = useRef<string | null>(null);
  const [settleTarget, setSettleTarget] = useState<ProcessingRow | null>(null);
  const [settleReload, setSettleReload] = useState<(() => Promise<unknown>) | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleRef, setSettleRef] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settleBusy, setSettleBusy] = useState(false);
  const [flowTarget, setFlowTarget] = useState<ProcessingRow | null>(null);
  const [flowSteps, setFlowSteps] = useState<ProcessingOrderStepRow[]>([]);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [statsFrom, setStatsFrom] = useState('');
  const [statsTo, setStatsTo] = useState('');
  const stats = useQuery({
    queryKey: ['processing-settle-stats'],
    queryFn: () => apiRequest<SettleStats>('/processing-orders/settle-stats'),
  });
  const flowStats = useQuery({
    queryKey: ['processing-flow-stats', statsFrom, statsTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statsFrom) params.set('from', statsFrom);
      if (statsTo) params.set('to', statsTo);
      const queryString = params.toString();
      return apiRequest<ProcessingFlowStatsData>(`/processing-flow-stats${queryString ? `?${queryString}` : ''}`);
    },
  });

  async function openFlow(row: ProcessingRow) {
    setFlowTarget(row);
    setFlowSteps([]);
    setFlowError(null);
    setFlowLoading(true);
    try {
      const steps = await apiRequest<ProcessingOrderStepRow[]>(`/processing-orders/${row.id}/steps`);
      setFlowSteps(steps);
    } catch (error) {
      setFlowError(errorMessage(error, '加载流程失败'));
    } finally {
      setFlowLoading(false);
    }
  }

  function closeFlow() {
    setFlowTarget(null);
    setFlowSteps([]);
    setFlowError(null);
  }

  async function advanceFlow() {
    if (!flowTarget || flowBusy) return;
    setFlowBusy(true);
    try {
      const steps = await apiRequest<ProcessingOrderStepRow[]>(
        `/processing-orders/${flowTarget.id}/register-step`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setFlowSteps(steps);
      showToast('流程已推进', 'success');
    } catch (error) {
      showToast(errorMessage(error, '推进流程失败'), 'error');
    } finally {
      setFlowBusy(false);
    }
  }

  async function adjustStep(step: ProcessingOrderStepRow, status: string) {
    if (!flowTarget || flowBusy) return;
    setFlowBusy(true);
    try {
      const updated = await apiRequest<ProcessingOrderStepRow>(
        `/processing-orders/${flowTarget.id}/set-step`,
        {
          method: 'POST',
          body: JSON.stringify({ stepId: step.stepId ?? step.id, status }),
        },
      );
      setFlowSteps((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      showToast('步骤状态已调整', 'success');
    } catch (error) {
      showToast(errorMessage(error, '调整步骤失败'), 'error');
    } finally {
      setFlowBusy(false);
    }
  }

  function openSettle(row: ProcessingRow, reload: () => Promise<unknown>) {
    setSettleTarget(row);
    setSettleReload(() => reload);
    setSettleAmount(row.totalFee !== null && row.totalFee !== undefined ? (Number(row.totalFee) / 100).toFixed(2) : '');
    setSettleRef('');
    setSettleNote('');
  }

  function closeSettle() {
    setSettleTarget(null);
    setSettleReload(null);
    setSettleAmount('');
    setSettleRef('');
    setSettleNote('');
  }

  async function submitSettle(event: FormEvent) {
    event.preventDefault();
    if (settleBusy || !settleTarget) return;
    const amount = toCents(settleAmount);
    if (!settleAmount.trim() || !Number.isFinite(amount) || amount < 0) {
      showToast('请输入有效的结算金额', 'error');
      return;
    }
    setSettleBusy(true);
    try {
      await apiRequest(`/processing-orders/${settleTarget.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          ref: settleRef.trim() || undefined,
          note: settleNote.trim() || undefined,
        }),
      });
      showToast('加工单已结算', 'success');
      closeSettle();
      await settleReload?.();
      void stats.refetch();
    } catch (error) {
      showToast(errorMessage(error, '结算失败'), 'error');
    } finally {
      setSettleBusy(false);
    }
  }

  async function unsettleProcessingOrder(row: ProcessingRow, reload: () => Promise<unknown>) {
    try {
      await apiRequest(`/processing-orders/${row.id}/unsettle`, { method: 'POST' });
      showToast('已撤销结算', 'success');
      await reload();
      void stats.refetch();
    } catch (error) {
      showToast(errorMessage(error, '撤销结算失败'), 'error');
    }
  }

  return (
    <>
      {stats.data && (
        <div className="settle-summary">
          <span>未结算 {stats.data.unsettled?.count ?? 0} 单（金额 {formatMoney(stats.data.unsettled?.feeTotal ?? 0)}）</span>
          <span>已结算 {stats.data.settled?.count ?? 0} 单（金额 {formatMoney(stats.data.settled?.amountTotal ?? 0)}）</span>
        </div>
      )}
      <CrudPage<ProcessingRow, ProcessingOrderForm>
        title="加工单管理"
        createLabel="新建加工单"
        emptyMessage="暂无加工单"
        queryKey={['processing-orders']}
        endpoint="/resources/processingOrders"
        initialForm={() => {
          editingIdRef.current = null;
          editingStatusRef.current = null;
          return emptyProcessingForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          editingStatusRef.current = String(row.status ?? '');
          return {
            patientId: String(row.patientId ?? ''),
            doctorId: String(row.doctorId ?? ''),
            number: String(row.number ?? ''),
            shade: String(row.shade ?? ''),
            teethNumbers: joinList(row.teethNumbers),
            totalFee: row.totalFee === null || row.totalFee === undefined ? '' : (Number(row.totalFee) / 100).toFixed(2),
            items: [newItem()],
          };
        }}
        validate={(form) => {
          const validItems = buildValidItems(form.items);
          if (!form.patientId || !form.number.trim() || validItems.length === 0) {
            return '请选择患者、填写加工单号并至少添加一条有效明细';
          }
          return null;
        }}
        submitOverride={async ({ form, editing }) => {
          const validItems = buildValidItems(form.items);
          // 已填写（有名称）但数量/单价无效的明细会被静默丢弃，提交前提示
          const dropped = form.items.filter((item) => item.name.trim()).length - validItems.length;
          if (dropped > 0) showToast(`${dropped} 条明细因缺少有效数量或单价将被忽略`, 'info');
          const calculatedTotalFee = validItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
          if (editing) {
            const orderId = editingIdRef.current;
            if (!orderId) throw new Error('缺少编辑记录 ID');
            await apiRequest(`/resources/processingOrders/${orderId}`, {
              method: 'PATCH',
              body: JSON.stringify({
                patientId: form.patientId,
                doctorId: form.doctorId || undefined,
                number: form.number.trim(),
                shade: form.shade || undefined,
                teethNumbers: splitList(form.teethNumbers),
                totalFee: toCents(form.totalFee) || calculatedTotalFee,
                status: editingStatusRef.current ?? 'DRAFT',
              }),
            });
            await reconcileProcessingItems(orderId, form.items);
            return;
          }
          await apiRequest('/processing-orders', {
            method: 'POST',
            body: JSON.stringify({
              patientId: form.patientId,
              doctorId: form.doctorId || undefined,
              number: form.number.trim(),
              shade: form.shade || undefined,
              teethNumbers: splitList(form.teethNumbers),
              totalFee: toCents(form.totalFee) || calculatedTotalFee,
              items: validItems,
              requestId: crypto.randomUUID(),
            }),
          });
        }}
        messages={{ create: '加工单已创建', update: '加工单已更新', delete: '加工单已删除' }}
        errorMessages={{ create: '创建加工单失败', update: '更新加工单失败', delete: '删除加工单失败' }}
        columns={processingColumns}
        canEdit
        canDelete
        rowActions={(row, ctx) => (
          <>
            <button onClick={() => void openFlow(row)}>流程</button>
            <select
              defaultValue=""
              aria-label="变更加工状态"
              onChange={(event) => {
                if (event.target.value) void transitionProcessingOrder(showToast, ctx.reload, row.id, event.target.value);
              }}
            >
              <option value="">变更状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {row.settleStatus === 'SETTLED' ? (
              <button onClick={() => void unsettleProcessingOrder(row, ctx.reload)}>撤销结算</button>
            ) : (
              <button onClick={() => openSettle(row, ctx.reload)}>结算</button>
            )}
          </>
        )}
        renderForm={(ctx) => (
          <ProcessingOrderFormFields
            form={ctx.form}
            update={ctx.update}
            editing={ctx.editing}
            editingId={editingIdRef.current}
          />
        )}
      />
      <section>
        <h2>流程统计</h2>
        <div className="inline-form">
          <input aria-label="统计开始日期" type="date" value={statsFrom} onChange={(event) => setStatsFrom(event.target.value)} />
          <input aria-label="统计结束日期" type="date" value={statsTo} onChange={(event) => setStatsTo(event.target.value)} />
        </div>
        <DataTable
          columns={flowStatsColumns}
          rows={flowStats.data?.steps ?? []}
          keyField="stepId"
          emptyText="暂无流程统计数据"
        />
      </section>
      <Dialog open={settleTarget !== null} title="结算加工单" onClose={closeSettle}>
        <form onSubmit={submitSettle}>
          <label>
            结算金额（元）
            <input type="number" min="0" step="0.01" value={settleAmount} onChange={(event) => setSettleAmount(event.target.value)} />
          </label>
          <label>
            结算单号
            <input value={settleRef} onChange={(event) => setSettleRef(event.target.value)} />
          </label>
          <label>
            备注
            <textarea value={settleNote} onChange={(event) => setSettleNote(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={closeSettle}>取消</button>
            <button type="submit" disabled={settleBusy}>{settleBusy ? '结算中...' : '确认结算'}</button>
          </div>
        </form>
      </Dialog>
      <Dialog open={flowTarget !== null} title={`加工流程 - ${flowTarget?.number ?? ''}`} onClose={closeFlow}>
        {flowLoading && <LoadingState label="流程加载中..." />}
        {flowError && !flowLoading && (
          <>
            <PageError message={flowError} />
            <div className="modal-actions">
              <button type="button" onClick={closeFlow}>关闭</button>
            </div>
          </>
        )}
        {!flowLoading && !flowError && (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>步骤</th><th>状态</th><th>完成时间</th><th>调整</th></tr></thead>
                <tbody>
                  {flowSteps.map((step) => (
                    <tr key={String(step.id)}>
                      <td>{step.stepName}</td>
                      <td>{FLOW_STATUS_LABELS[step.status] ?? step.status}</td>
                      <td>{step.completedAt ? formatDateTime(step.completedAt) : '—'}</td>
                      <td>
                        <select
                          aria-label={`调整${step.stepName}`}
                          value={step.status}
                          disabled={flowBusy}
                          onChange={(event) => void adjustStep(step, event.target.value)}
                        >
                          {FLOW_STATUSES.map((status) => (
                            <option key={status} value={status}>{FLOW_STATUS_LABELS[status]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={closeFlow}>关闭</button>
              <button type="button" onClick={() => void advanceFlow()} disabled={flowBusy}>
                {flowBusy ? '推进中...' : '推进'}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

async function transitionProcessingOrder(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
) {
  try {
    await apiRequest(`/processing-orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('加工单状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  }
}

function ProcessingOrderFormFields({
  form,
  update,
  editing,
  editingId,
}: {
  form: ProcessingOrderForm;
  update: (patch: Partial<ProcessingOrderForm>) => void;
  editing: boolean;
  editingId: string | null;
}) {
  const doctors = useQuery({
    queryKey: ['processing-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const loadedItemsForRef = useRef<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing || !editingId || loadedItemsForRef.current === editingId) return;
    let cancelled = false;
    loadedItemsForRef.current = editingId;
    setItemsError(null);
    apiRequest<Page<ProcessingOrderItemRow>>(`/resources/processingOrderItems?orderId=${editingId}&page=1&pageSize=100`)
      .then((data) => {
        if (cancelled) return;
        update({
          items: (data.items ?? []).map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ''),
            spec: String(row.spec ?? ''),
            quantity: String(row.quantity ?? '1'),
            unitPrice: (Number(row.unitPrice ?? 0) / 100).toFixed(2),
            subtotal: (Number(row.subtotal ?? 0) / 100).toFixed(2),
            status: String(row.status ?? 'DRAFT'),
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setItemsError('明细加载失败，请关闭后重试');
      });
    return () => {
      cancelled = true;
    };
  }, [editing, editingId, update]);
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">不指定</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        加工单号
        <input value={form.number} onChange={(event) => update({ number: event.target.value })} />
      </label>
      <label>
        颜色
        <input value={form.shade} onChange={(event) => update({ shade: event.target.value })} />
      </label>
      <label>
        牙位（逗号分隔）
        <input value={form.teethNumbers} onChange={(event) => update({ teethNumbers: event.target.value })} />
      </label>
      <label>
        总费用
        <input type="number" min="0" value={form.totalFee} onChange={(event) => update({ totalFee: event.target.value })} />
      </label>
      {itemsError && <p className="error">{itemsError}</p>}
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <input aria-label="加工项目" value={item.name} placeholder="项目名称" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} />
          <input aria-label="加工数量" type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
          <input aria-label="加工单价" type="number" min="0" value={item.unitPrice} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, unitPrice: event.target.value } : entry) })} />
          <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
    </>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function validFormItems(items: ProcessingItemForm[]): ProcessingItemForm[] {
  return items.filter((item) => {
    if (!item.name.trim() || !item.quantity || !item.unitPrice) return false;
    return Number(item.quantity) > 0 && toCents(item.unitPrice) >= 0;
  });
}

/** 编辑保存时的明细 reconcile：有 id 的行 PATCH，新行 POST（带 orderId），被移除的行 DELETE。 */
async function reconcileProcessingItems(orderId: string, items: ProcessingItemForm[]): Promise<void> {
  const existing = await apiRequest<Page<ProcessingOrderItemRow>>(
    `/resources/processingOrderItems?orderId=${orderId}&page=1&pageSize=100`,
  );
  const existingById = new Map(existing.items.map((row) => [String(row.id), row]));
  const keptIds = new Set<string>();
  for (const item of validFormItems(items)) {
    const quantity = Number(item.quantity);
    const unitPrice = toCents(item.unitPrice);
    if (item.id && existingById.has(item.id)) {
      keptIds.add(item.id);
      await apiRequest(`/resources/processingOrderItems/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: item.name.trim(),
          spec: item.spec.trim() || undefined,
          quantity,
          unitPrice,
          subtotal: Math.round(unitPrice * quantity),
          status: item.status || 'DRAFT',
        }),
      });
    } else {
      await apiRequest('/resources/processingOrderItems', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          name: item.name.trim(),
          spec: item.spec.trim() || undefined,
          quantity,
          unitPrice,
          subtotal: Math.round(unitPrice * quantity),
          status: 'DRAFT',
        }),
      });
    }
  }
  for (const row of existing.items) {
    if (!keptIds.has(String(row.id))) {
      await apiRequest(`/resources/processingOrderItems/${String(row.id)}`, { method: 'DELETE' });
    }
  }
}
