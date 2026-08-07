import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { DataTable, Dialog, LoadingState, PageError } from './components';
import { formatDateTime, formatMoney, toCents, centsToYuanString } from './format';
import { errorMessage } from './messages';
import { useAsyncAction } from './use-async-action';
import { useToast } from './toast-context';
import {
  FLOW_STATUSES,
  FLOW_STATUS_LABELS,
  STATUS_LABELS,
  type ProcessingFlowStatsData,
  type ProcessingOrderForm,
  type ProcessingOrderStepRow,
  type ProcessingRow,
  type SettleStats,
} from './processing-orders/types';
import { buildValidItems, emptyProcessingForm, joinList, newItem, reconcileProcessingItems } from './processing-orders/items';
import { splitList } from './format';
import { flowStatsColumns, processingColumns } from './processing-orders/columns';
import { ProcessingOrderFormFields } from './processing-orders/ProcessingOrderFormFields';

export function ProcessingOrdersPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const editingStatusRef = useRef<string | null>(null);
  // 流程对话框请求序号守卫：关闭/重开时使在途响应失效，避免旧响应覆盖新状态
  const flowRequestIdRef = useRef(0);
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
    const requestId = ++flowRequestIdRef.current;
    setFlowTarget(row);
    setFlowSteps([]);
    setFlowError(null);
    setFlowLoading(true);
    setFlowBusy(false);
    try {
      const steps = await apiRequest<ProcessingOrderStepRow[]>(`/processing-orders/${row.id}/steps`);
      if (flowRequestIdRef.current !== requestId) return;
      setFlowSteps(steps);
    } catch (error) {
      if (flowRequestIdRef.current !== requestId) return;
      setFlowError(errorMessage(error, '加载流程失败'));
    } finally {
      if (flowRequestIdRef.current === requestId) setFlowLoading(false);
    }
  }

  function closeFlow() {
    // 使所有在途流程请求失效并复位 busy/loading，避免旧响应或状态卡死
    flowRequestIdRef.current += 1;
    setFlowTarget(null);
    setFlowSteps([]);
    setFlowError(null);
    setFlowLoading(false);
    setFlowBusy(false);
  }

  async function advanceFlow() {
    if (!flowTarget || flowBusy) return;
    const requestId = ++flowRequestIdRef.current;
    setFlowBusy(true);
    try {
      const steps = await apiRequest<ProcessingOrderStepRow[]>(
        `/processing-orders/${flowTarget.id}/register-step`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (flowRequestIdRef.current !== requestId) return;
      setFlowSteps(steps);
      showToast('流程已推进', 'success');
    } catch (error) {
      if (flowRequestIdRef.current !== requestId) return;
      showToast(errorMessage(error, '推进流程失败'), 'error');
    } finally {
      if (flowRequestIdRef.current === requestId) setFlowBusy(false);
    }
  }

  async function adjustStep(step: ProcessingOrderStepRow, status: string) {
    if (!flowTarget || flowBusy) return;
    const requestId = ++flowRequestIdRef.current;
    setFlowBusy(true);
    try {
      const updated = await apiRequest<ProcessingOrderStepRow>(
        `/processing-orders/${flowTarget.id}/set-step`,
        {
          method: 'POST',
          body: JSON.stringify({ stepId: step.stepId ?? step.id, status }),
        },
      );
      if (flowRequestIdRef.current !== requestId) return;
      setFlowSteps((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      showToast('步骤状态已调整', 'success');
    } catch (error) {
      if (flowRequestIdRef.current !== requestId) return;
      showToast(errorMessage(error, '调整步骤失败'), 'error');
    } finally {
      if (flowRequestIdRef.current === requestId) setFlowBusy(false);
    }
  }

  function openSettle(row: ProcessingRow, reload: () => Promise<unknown>) {
    setSettleTarget(row);
    setSettleReload(() => reload);
    setSettleAmount(centsToYuanString(row.totalFee));
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
            totalFee: centsToYuanString(row.totalFee),
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
            try {
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
            } catch (error) {
              throw new Error(`${errorMessage(error, '更新加工单失败')}；部分明细可能未保存，请核对后重试`);
            }
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
            <ProcessingStatusSelect
              rowId={row.id}
              onTransition={(id, status) => transitionProcessingOrder(showToast, ctx.reload, id, status)}
            />
            {row.settleStatus === 'SETTLED' ? (
              <UnsettleButton onDone={() => unsettleProcessingOrder(row, ctx.reload)} />
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

/** 行内受控状态下拉：选中后立即复位为占位项，避免非受控 select 在行复用后残留旧值；busy 期间禁用。 */
function ProcessingStatusSelect({ rowId, onTransition }: {
  rowId: string;
  onTransition: (id: string, status: string) => Promise<void>;
}) {
  const { busy, run } = useAsyncAction();
  const [value, setValue] = useState('');
  return (
    <select
      value={value}
      aria-label="变更加工状态"
      disabled={busy}
      onChange={(event) => {
        const next = event.target.value;
        setValue('');
        if (next) void run(() => onTransition(rowId, next));
      }}
    >
      <option value="">变更状态</option>
      {Object.entries(STATUS_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}

/** 行内“撤销结算”按钮：busy 期间禁用，防止双击重复撤销。 */
function UnsettleButton({ onDone }: { onDone: () => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy} onClick={() => run(onDone)}>
      {busy ? '撤销中...' : '撤销结算'}
    </button>
  );
}
