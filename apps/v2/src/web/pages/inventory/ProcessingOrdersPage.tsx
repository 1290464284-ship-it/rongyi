import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { DataTable } from '../../components';
import { formatMoney, toCents, centsToYuanString } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';
import {
  type ProcessingFlowStatsData,
  type ProcessingOrderForm,
  type ProcessingOrderStepRow,
  type ProcessingRow,
  type SettleStats,
} from '../../processing-orders/types';
import { buildValidItems, emptyProcessingForm, joinList, newItem, reconcileProcessingItems } from '../../processing-orders/items';
import { splitList } from '../../lib/format';
import { flowStatsColumns, processingColumns } from '../../processing-orders/columns';
import { ProcessingOrderFormFields } from '../../processing-orders/ProcessingOrderFormFields';
import { transitionProcessingOrder } from '../../processing-orders/api';
import { ProcessingStatusSelect } from '../../processing-orders/ProcessingStatusSelect';
import { ProcessingSettleDialog } from './ProcessingSettleDialog';
import { ProcessingFlowDialog } from './ProcessingFlowDialog';

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
          itemsLoadedRef.current = false;
          return emptyProcessingForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          editingStatusRef.current = String(row.status ?? '');
          itemsLoadedRef.current = false;
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
            <button disabled={ctx.stale} onClick={() => { if (ctx.stale) return; void openFlow(row); }}>流程</button>
            <ProcessingStatusSelect
              rowId={row.id}
              onTransition={(id, status) => {
                if (ctx.stale) return;
                transitionProcessingOrder(showToast, ctx.reload, id, status);
              }}
            />
            {row.settleStatus === 'SETTLED' ? (
              <UnsettleButton disabled={ctx.stale} onDone={() => unsettleProcessingOrder(row, ctx.reload)} />
            ) : (
              <button disabled={ctx.stale} onClick={() => { if (ctx.stale) return; openSettle(row, ctx.reload); }}>结算</button>
            )}
          </>
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

/** 行内“撤销结算”按钮：busy 期间禁用，防止双击重复撤销。 */
function UnsettleButton({ onDone, disabled }: { onDone: () => Promise<void>; disabled?: boolean }) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy || disabled} onClick={() => { if (disabled) return; run(onDone); }}>
      {busy ? '撤销中...' : '撤销结算'}
    </button>
  );
}
