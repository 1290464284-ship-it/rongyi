import { useRef, useState } from 'react';
import { apiRequest, fetchAllPages } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { Dialog, type DataTableColumn } from '../../components';
import { formatMoney, toCents, centsToYuanString } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast, type ToastKind } from '../../lib/toast-context';
import { PlanBillingDialog } from '../../treatment-plans/PlanBillingDialog';
import { PlanFormFields } from '../../treatment-plans/PlanFormFields';
import { PrintPreview } from '../../treatment-plans/PrintPreview';
import { SignForm } from '../../treatment-plans/SignForm';
import { PlanFollowUpDialog } from '../../treatment-plans/PlanFollowUpDialog';
import {
  PLAN_DISCOUNT_LABELS,
  type PlanRow,
  type TreatmentPlanForm,
  type TreatmentPlanPrintResult,
} from '../../treatment-plans/types';
import { FOLLOW_UP_STATUS_LABELS, CLINICAL_STATUS_LABELS } from '../../lib/labels';
import { buildValidItems, cleanupOrphanPlan, emptyPlanForm, newItem, updatePlanWithItems } from '../../treatment-plans/plan-utils';

const planColumns: DataTableColumn<PlanRow>[] = [
  { key: 'name', label: '计划名称' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'totalFee', label: '总费用', render: (row) => formatMoney(row.totalFee) },
  {
    key: 'status',
    label: '状态',
    render: (row) => {
      const value = String(row.status ?? '');
      return CLINICAL_STATUS_LABELS[value] ?? value;
    },
  },
  { key: 'printCount', label: '打印次数', render: (row) => String(row.printCount ?? 0) },
  { key: 'signedAt', label: '签字', render: (row) => (row.signedAt ? '已签' : '未签') },
  {
    key: 'discount',
    label: '折扣',
    render: (row) => (
      row.discountType && row.discountType !== 'NONE'
        ? `${PLAN_DISCOUNT_LABELS[row.discountType] ?? row.discountType} ${row.discountRate ?? 0}%`
        : '无折扣'
    ),
  },
  {
    key: 'followUpStatus',
    label: '回访',
    render: (row) => {
      const rawStatus = String(row.followUpStatus ?? 'NONE');
      const label = FOLLOW_UP_STATUS_LABELS[rawStatus] ?? rawStatus;
      // 列表列只展示日期部分（避免裸渲 ISO 时间戳）
      const dateOnly = String(row.nextFollowUpAt ?? '').slice(0, 10);
      return row.nextFollowUpAt ? `${label}（${dateOnly}）` : label;
    },
  },
];

export function TreatmentPlansPage() {
  const { showToast } = useToast();
  // submitOverride 只收到 { form, editing } 不带 id：用 ref 记录当前编辑目标（参考 PatientsPage）
  const editingIdRef = useRef<string | null>(null);
  // 编辑会话中明细是否已加载完成；未完成时禁止提交，防止空白明细被当作新建行重复 POST
  const itemsLoadedRef = useRef(false);
  const [printResult, setPrintResult] = useState<TreatmentPlanPrintResult | null>(null);
  const [signTarget, setSignTarget] = useState<{ row: PlanRow; reload: () => Promise<unknown> } | null>(null);
  const [billingTarget, setBillingTarget] = useState<{ row: PlanRow; reload: () => Promise<unknown> } | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<{ row: PlanRow; reload: () => Promise<unknown> } | null>(null);

  return (
    <>
      <CrudPage<PlanRow, TreatmentPlanForm>
        title="治疗计划管理"
        createLabel="新建治疗计划"
        emptyMessage="暂无治疗计划"
        queryKey={['treatment-plans']}
        endpoint="/resources/treatmentPlans"
        paged
        initialForm={() => {
          editingIdRef.current = null;
          itemsLoadedRef.current = false;
          return emptyPlanForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          itemsLoadedRef.current = false;
          return {
            patientId: String(row.patientId ?? ''),
            doctorId: String(row.doctorId ?? ''),
            name: String(row.name ?? ''),
            status: String(row.status ?? 'APPROVED'),
            totalFee: centsToYuanString(row.totalFee),
            totalFeeConfirmed: false,
            remark: String(row.remark ?? ''),
            // 明细行由 PlanFormFields 打开编辑时异步拉取回填（formFromRow 为同步）
            items: [newItem()],
          };
        }}
        validate={(form) => {
          if (editingIdRef.current && !itemsLoadedRef.current) {
            return '明细加载中，请稍候再保存';
          }
          const validItems = buildValidItems(form.items);
          if (!form.patientId || !form.doctorId || !form.name.trim() || validItems.length === 0) {
            return '请选择患者、医生并填写计划名称和至少一条有效明细';
          }
          return null;
        }}
        submitOverride={async ({ form, editing }) => {
          const validItems = buildValidItems(form.items);
          // 已填写（有名称）但价格/数量无效的明细会被静默丢弃，提交前提示
          const dropped = form.items.filter((item) => item.name.trim()).length - validItems.length;
          if (dropped > 0) showToast(`${dropped} 条明细因缺少有效价格或数量将被忽略`, 'info');
          if (editing) {
            await updatePlanWithItems(form, editingIdRef.current);
            return;
          }
          const calculatedFee = validItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
          let planId: string | null = null;
          const createdItemIds: string[] = [];
          try {
            const plan = await apiRequest<{ id: string }>('/resources/treatmentPlans', {
              method: 'POST',
              body: JSON.stringify({
                patientId: form.patientId,
                doctorId: form.doctorId,
                name: form.name.trim(),
                status: form.status,
                totalFee: toCents(form.totalFee) || calculatedFee,
                remark: form.remark || undefined,
              }),
            });
            planId = plan.id;
            for (const item of validItems) {
              const created = await apiRequest<{ id: string }>('/resources/treatmentPlanItems', {
                method: 'POST',
                body: JSON.stringify({ planId: plan.id, ...item }),
              });
              createdItemIds.push(created.id);
            }
          } catch (error) {
            // 主记录已创建但明细中途失败：清理孤儿记录（清理失败仅告警，不掩盖原始错误）
            if (planId) {
              // cleanupOrphanPlan 内部已对每次 DELETE 分别 try/catch（失败仅告警），
              // 函数本身不会 reject，此处的 catch 兜底不可达。
              await cleanupOrphanPlan(planId, createdItemIds, showToast);
            }
            throw error;
          }
        }}
        messages={{ create: '治疗计划已创建', update: '治疗计划已更新', delete: '治疗计划已删除' }}
        errorMessages={{ create: '创建治疗计划失败', update: '更新治疗计划失败', delete: '删除治疗计划失败' }}
        columns={planColumns}
        canEdit
        canDelete
        deleteOverride={async (row) => {
          // 服务端 DELETE 为软删除且不级联：先删全部明细，再删主记录（明细删除失败仅告警）
          const planId = String(row.id);
          try {
            const items = await fetchAllPages<Record<string, unknown>>(
              `/resources/treatmentPlanItems?planId=${planId}`,
            );
            for (const item of items) {
              await apiRequest(`/resources/treatmentPlanItems/${String(item.id)}`, { method: 'DELETE' });
            }
          } catch (error) {
            console.warn(`删除治疗计划明细失败（已中止删除主记录）：${planId}`, error);
            showToast('删除治疗计划明细失败，已中止删除主记录', 'error');
            throw error;
          }
          await apiRequest(`/resources/treatmentPlans/${planId}`, { method: 'DELETE' });
        }}
        rowActions={(row, ctx) => {
          const openBilling = () => {
            if (ctx.stale) return;
            setBillingTarget({ row, reload: ctx.reload });
          };
          const openFollowUp = () => {
            if (ctx.stale) return;
            setFollowUpTarget({ row, reload: ctx.reload });
          };
          const openPrint = () => {
            /* v8 ignore next -- 同上 */
            if (ctx.stale) return;
            void requestPrint(row, showToast, ctx.reload, setPrintResult);
          };
          const openSign = () => {
            /* v8 ignore next -- 同上 */
            if (ctx.stale) return;
            setSignTarget({ row, reload: ctx.reload });
          };
          return (
            <>
              <button disabled={ctx.stale} onClick={openBilling}>折扣</button>
              <button disabled={ctx.stale} onClick={openFollowUp}>回访</button>
              <button disabled={ctx.stale} onClick={openPrint}>打印</button>
              <button disabled={ctx.stale} onClick={openSign}>签字</button>
            </>
          );
        }}
        renderForm={(ctx) => (
          <PlanFormFields
            form={ctx.form}
            update={ctx.update}
            editing={ctx.editing}
            planId={ctx.editing ? editingIdRef.current : null}
            onItemsLoaded={() => { itemsLoadedRef.current = true; }}
          />
        )}
      />

      <Dialog open={printResult !== null} title="打印预览" onClose={() => setPrintResult(null)}>
        {printResult && <PrintPreview payload={printResult} onClose={() => setPrintResult(null)} />}
      </Dialog>

      <Dialog open={signTarget !== null} title="电子签字" onClose={() => setSignTarget(null)}>
        {signTarget && (
          <SignForm
            planId={signTarget.row.id}
            onClose={() => setSignTarget(null)}
            onSigned={() => signTarget.reload()}
          />
        )}
      </Dialog>

      <Dialog open={billingTarget !== null} title={billingTarget ? `明细与划价：${billingTarget.row.name ?? ''}` : '明细与划价'} onClose={() => setBillingTarget(null)}>
        {billingTarget && (
          <PlanBillingDialog
            plan={billingTarget.row}
            onClose={() => setBillingTarget(null)}
            onChanged={billingTarget.reload}
          />
        )}
      </Dialog>

      <Dialog open={followUpTarget !== null} title="计划回访" onClose={() => setFollowUpTarget(null)}>
        {followUpTarget && (
          <PlanFollowUpDialog
            plan={followUpTarget.row}
            onClose={() => setFollowUpTarget(null)}
            onSaved={followUpTarget.reload}
          />
        )}
      </Dialog>
    </>
  );
}

async function requestPrint(
  row: PlanRow,
  showToast: (message: string, kind?: ToastKind) => void,
  reload: () => Promise<unknown>,
  onResult: (payload: TreatmentPlanPrintResult) => void,
): Promise<void> {
  try {
    const data = await apiRequest<TreatmentPlanPrintResult>(`/treatment-plans/${row.id}/print`, { method: 'POST' });
    showToast(`已打印（第 ${data.plan.printCount ?? 0} 次）`, 'success');
    await reload();
    onResult(data);
  } catch (error) {
    showToast(errorMessage(error, '打印失败'), 'error');
  }
}
