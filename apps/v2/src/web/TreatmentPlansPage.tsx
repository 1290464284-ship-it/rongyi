import { useRef, useState } from 'react';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast, type ToastKind } from './toast-context';
import { PlanBillingDialog } from './treatment-plans/PlanBillingDialog';
import { PlanFormFields } from './treatment-plans/PlanFormFields';
import { PrintPreview } from './treatment-plans/PrintPreview';
import { SignForm } from './treatment-plans/SignForm';
import { FollowUpDialog } from './treatment-plans/FollowUpDialog';
import {
  FOLLOW_UP_LABELS,
  PLAN_DISCOUNT_LABELS,
  type PlanRow,
  type TreatmentPlanForm,
  type TreatmentPlanPrintResult,
} from './treatment-plans/plan-types';
import { buildValidItems, cleanupOrphanPlan, emptyPlanForm, newItem, updatePlanWithItems } from './treatment-plans/plan-utils';

const planColumns: DataTableColumn<PlanRow>[] = [
  { key: 'name', label: '计划名称' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'totalFee', label: '总费用', render: (row) => formatMoney(row.totalFee) },
  { key: 'status', label: '状态' },
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
      const label = FOLLOW_UP_LABELS[String(row.followUpStatus ?? 'NONE')] ?? String(row.followUpStatus ?? 'NONE');
      return row.nextFollowUpAt ? `${label}（${String(row.nextFollowUpAt)}）` : label;
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
            totalFee: row.totalFee === null || row.totalFee === undefined ? '' : (Number(row.totalFee) / 100).toFixed(2),
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
              try {
                await cleanupOrphanPlan(planId, createdItemIds);
              } catch (cleanupError) {
                console.warn('清理孤儿治疗计划失败', cleanupError);
              }
            }
            throw error;
          }
        }}
        messages={{ create: '治疗计划已创建', update: '治疗计划已更新', delete: '治疗计划已删除' }}
        errorMessages={{ create: '创建治疗计划失败', update: '更新治疗计划失败', delete: '删除治疗计划失败' }}
        columns={planColumns}
        canEdit
        canDelete
        rowActions={(row, ctx) => (
          <>
            <button onClick={() => setBillingTarget({ row, reload: ctx.reload })}>折扣</button>
            <button onClick={() => setFollowUpTarget({ row, reload: ctx.reload })}>回访</button>
            <button onClick={() => void requestPrint(row, showToast, ctx.reload, setPrintResult)}>打印</button>
            <button onClick={() => setSignTarget({ row, reload: ctx.reload })}>签字</button>
          </>
        )}
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
          <FollowUpDialog
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
