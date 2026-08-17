import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { toCents, splitList } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import {
  type ProcessingFlowStatsData,
  type ProcessingOrderForm,
  type ProcessingOrderStepRow,
  type ProcessingRow,
  type SettleStats,
} from '../../processing-orders/types';
import { buildValidItems, emptyProcessingForm, reconcileProcessingItems } from '../../processing-orders/items';
import { processingColumns } from '../../processing-orders/columns';
import { ProcessingOrderFormFields } from '../../processing-orders/ProcessingOrderFormFields';
import { ProcessingSettleDialog } from './ProcessingSettleDialog';
import { ProcessingFlowDialog } from './ProcessingFlowDialog';
import { ProcessingRowActions } from './ProcessingRowActions';
import { ProcessingFlowStatsSection, ProcessingSettleSummary } from './processing-stats';
import { rowToProcessingForm } from './processing-order-form';

export function ProcessingOrdersPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const editingStatusRef = useRef<string | null>(null);
  const itemsLoadedRef = useRef(false);
  // 流程对话框请求序号守卫：关闭/重开时使在途响应失效，避免旧响应覆盖新状态
  const flowRequestIdRef = useRef(0);
  const [settleTarget, setSettleTarget] = useState<ProcessingRow | null>(null);
  const [settleReload, setSettleReload] = useState<(() => Promise<unknown>) | null>(null);
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

  /** 仅当请求序号仍最新时应用推进结果，过期响应静默丢弃。 */
  function applyAdvanceSteps(requestId: number, steps: ProcessingOrderStepRow[]): void {
    const current = flowRequestIdRef.current;
    if (current === requestId) setFlowSteps(steps);
    if (current === requestId) showToast('流程已推进', 'success');
  }

  /** 仅当请求序号仍最新时应用步骤调整，过期响应静默丢弃。 */
  function applyAdjustStep(requestId: number, updated: ProcessingOrderStepRow): void {
    const current = flowRequestIdRef.current;
    if (current === requestId) setFlowSteps((currentSteps) => currentSteps.map((entry) => (entry.id === updated.id ? updated : entry)));
    if (current === requestId) showToast('步骤状态已调整', 'success');
  }

  async function advanceFlow() {
    /* v8 ignore next -- 推进按钮仅在 flowTarget 非空时渲染，busy 时 disabled */
    if (!flowTarget || flowBusy) return;
    const requestId = ++flowRequestIdRef.current;
    setFlowBusy(true);
    try {
      const steps = await apiRequest<ProcessingOrderStepRow[]>(
        `/processing-orders/${flowTarget.id}/register-step`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      applyAdvanceSteps(requestId, steps);
    } catch (error) {
      if (flowRequestIdRef.current === requestId) {
        showToast(errorMessage(error, '推进流程失败'), 'error');
      }
    } finally {
      if (flowRequestIdRef.current === requestId) setFlowBusy(false);
    }
  }

  async function adjustStep(step: ProcessingOrderStepRow, status: string) {
    /* v8 ignore next -- 调整控件仅在 flowTarget 非空时渲染，busy 时 disabled */
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
      applyAdjustStep(requestId, updated);
    } catch (error) {
      if (flowRequestIdRef.current === requestId) {
        showToast(errorMessage(error, '调整步骤失败'), 'error');
      }
    } finally {
      if (flowRequestIdRef.current === requestId) setFlowBusy(false);
    }
  }

  function openSettle(row: ProcessingRow, reload: () => Promise<unknown>) {
    setSettleTarget(row);
    setSettleReload(() => reload);
  }

  function onRowFlow(ctx: { stale: boolean }, row: ProcessingRow) {
    /* v8 ignore next -- 按钮在 stale 期间 disabled，浏览器不派发点击 */
    if (ctx.stale) return;
    void openFlow(row);
  }

  function onRowSettle(ctx: { stale: boolean; reload: () => Promise<unknown> }, row: ProcessingRow) {
    /* v8 ignore next -- 按钮在 stale 期间 disabled，浏览器不派发点击 */
    if (ctx.stale) return;
    openSettle(row, ctx.reload);
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
      {stats.data && <ProcessingSettleSummary stats={stats.data} />}
      <CrudPage<ProcessingRow, ProcessingOrderForm>
        title="加工单管理"
        createLabel="新建加工单"
        emptyMessage="暂无加工单"
        queryKey={['processing-orders']}
        endpoint="/resources/processingOrders"
        paged
        initialForm={() => {
          editingIdRef.current = null;
          editingStatusRef.current = null;
          itemsLoadedRef.current = false;
          return emptyProcessingForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          editingStatusRef.current = String(row.status ?? '');
          itemsLoadedRef.current = false;
          return rowToProcessingForm(row);
        }}
        validate={(form) => {
          if (editingIdRef.current && !itemsLoadedRef.current) {
            return '明细加载中，请稍候再保存';
          }
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
            /* v8 ignore next -- 编辑态由 formFromRow 写入 orderId，恒非空 */
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
                  // 编辑态下 editingStatusRef 由 formFromRow 恒写入字符串
                  status: editingStatusRef.current,
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
          <ProcessingRowActions row={row} ctx={ctx} onFlow={onRowFlow} onSettle={onRowSettle} onUnsettle={unsettleProcessingOrder} />
        )}
        renderForm={(ctx) => (
          <ProcessingOrderFormFields
            form={ctx.form}
            update={ctx.update}
            editing={ctx.editing}
            editingId={editingIdRef.current}
            onItemsLoaded={() => { itemsLoadedRef.current = true; }}
          />
        )}
      />
      <ProcessingFlowStatsSection
        statsFrom={statsFrom}
        statsTo={statsTo}
        setStatsFrom={setStatsFrom}
        setStatsTo={setStatsTo}
        flowStats={flowStats}
      />
      <ProcessingSettleDialog
        key={settleTarget?.id ?? 'closed'}
        target={settleTarget}
        reload={settleReload}
        onSettled={() => void stats.refetch()}
        onClose={() => {
          setSettleTarget(null);
          setSettleReload(null);
        }}
        showToast={showToast}
      />
      <ProcessingFlowDialog
        target={flowTarget}
        steps={flowSteps}
        loading={flowLoading}
        busy={flowBusy}
        error={flowError}
        onClose={closeFlow}
        onAdvance={advanceFlow}
        onAdjust={adjustStep}
      />
    </>
  );
}
