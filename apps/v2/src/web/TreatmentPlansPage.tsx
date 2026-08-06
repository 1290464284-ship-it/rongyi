import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, LoadingState, PageError, SearchableSelect, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast, type ToastKind } from './toast-context';
import type { Page } from './types';

interface PlanRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  name?: string | null;
  totalFee?: number | null;
  status?: string | null;
  printCount?: number | null;
  signedAt?: string | null;
  discountType?: string | null;
  discountRate?: number | null;
  followUpStatus?: string | null;
  nextFollowUpAt?: string | null;
  trackingNote?: string | null;
}

/** 治疗计划明细行（/resources/treatmentPlanItems 列表行）。 */
interface PlanItemRow extends Record<string, unknown> {
  id: string;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  price?: number | null;
  quantity?: number | null;
  teethNumbers?: unknown;
  status?: string | null;
  discountRate?: number | null;
  billed?: boolean | number | null;
  billedChargeId?: string | null;
}

interface PlanItemForm {
  id: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  teethNumbers: string;
  status: string;
  /** 服务端 billed 状态；true 时行内输入与移除禁用（已划价保护）。 */
  billed: boolean;
}

interface TreatmentPlanForm {
  patientId: string;
  doctorId: string;
  name: string;
  status: string;
  totalFee: string;
  remark: string;
  items: PlanItemForm[];
}

/** 打印接口返回的可打印载荷摘要（POST /treatment-plans/:id/print 的 data）。 */
interface TreatmentPlanPrintResult {
  plan: Record<string, unknown> & {
    id?: string;
    name?: string | null;
    patientName?: string | null;
    doctorName?: string | null;
    printCount?: number | null;
  };
  items: Array<Record<string, unknown>>;
  template: Record<string, unknown> | null;
}

function newItem(): PlanItemForm {
  return { id: crypto.randomUUID(), code: '', name: '', category: '', price: '', quantity: '1', teethNumbers: '', status: 'PLANNED', billed: false };
}

function emptyPlanForm(): TreatmentPlanForm {
  return { patientId: '', doctorId: '', name: '', status: 'APPROVED', totalFee: '', remark: '', items: [newItem()] };
}

interface ValidPlanItem {
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  status: string;
}

function buildItemPayload(item: PlanItemForm): ValidPlanItem {
  return {
    code: item.code || `ITEM-${Date.now()}`,
    name: item.name.trim(),
    category: item.category || 'GENERAL',
    price: toCents(item.price),
    quantity: Number(item.quantity),
    teethNumbers: splitList(item.teethNumbers),
    status: item.status,
  };
}

function buildValidItems(items: PlanItemForm[]): ValidPlanItem[] {
  return items
    .filter((item) => item.name.trim() && item.price && item.quantity)
    .map(buildItemPayload)
    .filter((item) => item.price > 0 && item.quantity > 0);
}

/** 服务端明细行与表单 payload 是否完全一致（一致则编辑保存时跳过 PATCH）。 */
function isItemUnchanged(row: PlanItemRow, payload: ValidPlanItem): boolean {
  return (
    String(row.code ?? '') === payload.code &&
    String(row.name ?? '') === payload.name &&
    String(row.category ?? 'GENERAL') === payload.category &&
    Number(row.price ?? 0) === payload.price &&
    Number(row.quantity ?? 1) === payload.quantity &&
    String(row.status ?? 'PLANNED') === payload.status &&
    listEquals(row.teethNumbers, payload.teethNumbers)
  );
}

function listEquals(value: unknown, expected: string[]): boolean {
  const actual = Array.isArray(value) ? value.map(String) : [];
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

const PLAN_DISCOUNT_LABELS: Record<string, string> = {
  NONE: '无折扣',
  WHOLE: '整单折',
  DOUBLE: '折上折',
};

const FOLLOW_UP_LABELS: Record<string, string> = {
  NONE: '无',
  PENDING: '待回访',
  HORIZONTAL_SHOULD: '横向应访',
  HORIZONTAL_DONE: '横向已访',
  LOST: '流失',
};

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

function PrintPreview({ payload, onClose }: { payload: TreatmentPlanPrintResult; onClose: () => void }): ReactNode {
  return (
    <div className="print-preview">
      <p><strong>患者：</strong>{String(payload.plan.patientName ?? '')}</p>
      <p><strong>医生：</strong>{String(payload.plan.doctorName ?? '')}</p>
      <p><strong>计划名称：</strong>{String(payload.plan.name ?? '')}</p>
      <table>
        <thead>
          <tr><th>项目</th><th>数量</th><th>单价</th></tr>
        </thead>
        <tbody>
          {payload.items.map((item, index) => (
            <tr key={String(item.id ?? index)}>
              <td>{String(item.name ?? '')}</td>
              <td>{String(item.quantity ?? '')}</td>
              <td>{formatMoney(item.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><strong>模板：</strong>{String(payload.template?.name ?? '默认模板')}</p>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
        <button type="button" onClick={() => window.print()}>打印本页</button>
      </div>
    </div>
  );
}

function SignForm({
  planId,
  onClose,
  onSigned,
}: {
  planId: string;
  onClose: () => void;
  onSigned: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const [signature, setSignature] = useState('');
  const [signerName, setSignerName] = useState('');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!signature.trim() || !signerName.trim()) {
      showToast('请填写签名与签署人姓名', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/treatment-plans/${planId}/sign`, {
        method: 'POST',
        body: JSON.stringify({
          signature: signature.trim(),
          signerName: signerName.trim(),
          remark: remark.trim() || undefined,
        }),
      });
      showToast('签署完成', 'success');
      await onSigned();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '签署失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        签名图片
        <textarea
          aria-label="签名 dataURL"
          placeholder="粘贴签名图片 dataURL"
          value={signature}
          onChange={(event) => setSignature(event.target.value)}
        />
      </label>
      <label>
        签署人姓名
        <input aria-label="签署人姓名" value={signerName} onChange={(event) => setSignerName(event.target.value)} />
      </label>
      <label>
        备注
        <textarea aria-label="签名备注" value={remark} onChange={(event) => setRemark(event.target.value)} />
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={submitting}>{submitting ? '签署中...' : '签署'}</button>
      </div>
    </form>
  );
}

function PlanBillingDialog({
  plan,
  onClose,
  onChanged,
}: {
  plan: PlanRow;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [planType, setPlanType] = useState(String(plan.discountType ?? 'NONE'));
  const [planRate, setPlanRate] = useState(plan.discountRate === null || plan.discountRate === undefined ? '' : String(plan.discountRate));
  const [totalFee, setTotalFee] = useState(Number(plan.totalFee ?? 0));
  const [busy, setBusy] = useState(false);
  const [billBusy, setBillBusy] = useState(false);

  const itemsQuery = useQuery({
    queryKey: ['treatment-plan-items', plan.id],
    queryFn: () => apiRequest<Page<PlanItemRow>>(`/resources/treatmentPlanItems?planId=${plan.id}&page=1&pageSize=200`),
  });
  const items = itemsQuery.data?.items ?? [];
  const hasBilled = items.some((item) => Number(item.billed) === 1);

  async function refresh(): Promise<void> {
    await itemsQuery.refetch();
    await onChanged();
  }

  async function savePlanDiscount(): Promise<void> {
    const type = planType;
    if (type !== 'NONE') {
      const rate = Number(planRate);
      if (planRate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        showToast('折扣率须在 0-100 之间', 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const result = await apiRequest<{ id: string; discountType: string; discountRate: number | null; totalFee: number }>(
        `/treatment-plans/${plan.id}/discount`,
        {
          method: 'POST',
          body: JSON.stringify(type === 'NONE' ? { discountType: type } : { discountType: type, discountRate: Number(planRate) }),
        },
      );
      setTotalFee(Number(result.totalFee));
      showToast(`折扣已保存，总费用 ${formatMoney(result.totalFee)}`, 'success');
      await refresh();
    } catch (error) {
      showToast(errorMessage(error, '保存折扣失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveItemDiscount(item: PlanItemRow): Promise<void> {
    const raw = (drafts[item.id] ?? '').trim();
    const rate = raw === '' ? null : Number(raw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      showToast('折扣率须在 0-100 之间', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<{ itemId: string; discountRate: number | null; planTotalFee: number }>(
        `/treatment-plans/${plan.id}/items/${item.id}/discount`,
        {
          method: 'POST',
          body: JSON.stringify({ discountRate: rate }),
        },
      );
      setTotalFee(Number(result.planTotalFee));
      showToast(`明细折扣已保存，总费用 ${formatMoney(result.planTotalFee)}`, 'success');
      await refresh();
    } catch (error) {
      showToast(errorMessage(error, '保存明细折扣失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function bill(): Promise<void> {
    const selectedIds = items.filter((item) => selected[item.id]).map((item) => item.id);
    setBillBusy(true);
    try {
      const result = await apiRequest<{ chargeId: string; number: string; totalAmount: number; itemCount: number; billedItemIds: string[] }>(
        `/treatment-plans/${plan.id}/bill`,
        {
          method: 'POST',
          body: JSON.stringify(selectedIds.length > 0 ? { itemIds: selectedIds } : {}),
        },
      );
      setTotalFee(Number(result.totalAmount));
      setSelected({});
      showToast(`已生成划价单 ${result.number}`, 'success');
      await refresh();
    } catch (error) {
      showToast(errorMessage(error, '划价失败'), 'error');
    } finally {
      setBillBusy(false);
    }
  }

  return (
    <>
      <p>
        <strong>当前总费用：</strong>{formatMoney(totalFee)}
      </p>
      <div className="plan-discount-block">
        <strong>整单折扣</strong>
        {hasBilled && <p className="error">已存在已划价明细，整单折扣不可修改</p>}
        <select
          aria-label="整单折扣类型"
          value={planType}
          disabled={hasBilled}
          onChange={(event) => setPlanType(event.target.value)}
        >
          {Object.entries(PLAN_DISCOUNT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          aria-label="整单折扣率"
          type="number"
          min="0"
          max="100"
          value={planRate}
          disabled={hasBilled}
          placeholder="折扣率 0-100"
          onChange={(event) => setPlanRate(event.target.value)}
        />
        <button type="button" disabled={busy || hasBilled} onClick={() => void savePlanDiscount()}>
          {busy ? '保存中...' : '保存折扣'}
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" disabled={billBusy || items.length === 0} onClick={() => void bill()}>
          {billBusy ? '划价中...' : '划价'}
        </button>
      </div>
      {itemsQuery.isLoading && <LoadingState label="明细加载中..." />}
      {itemsQuery.error && <PageError message={itemsQuery.error.message} />}
      {!itemsQuery.isLoading && !itemsQuery.error && items.length === 0 && <p className="table-empty">暂无明细</p>}
      {items.length > 0 && (
        <table>
          <thead>
            <tr><th>勾选</th><th>项目</th><th>金额</th><th>折扣率</th><th>状态</th></tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const billed = Number(item.billed) === 1;
              const draft = drafts[item.id] ?? String(item.discountRate ?? '');
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`勾选划价 ${String(item.name ?? item.id)}`}
                      checked={Boolean(selected[item.id])}
                      disabled={billed}
                      onChange={(event) => setSelected({ ...selected, [item.id]: event.target.checked })}
                    />
                  </td>
                  <td>{String(item.name ?? item.id)}</td>
                  <td>{formatMoney(item.price)} × {Number(item.quantity ?? 1)}</td>
                  <td>
                    <input
                      aria-label={`明细折扣 ${String(item.name ?? item.id)}`}
                      type="number"
                      min="0"
                      max="100"
                      value={draft}
                      disabled={billed}
                      placeholder="0-100"
                      onChange={(event) => setDrafts({ ...drafts, [item.id]: event.target.value })}
                    />
                    <button type="button" disabled={busy || billed} onClick={() => void saveItemDiscount(item)}>保存</button>
                  </td>
                  <td>{billed ? <span className="role-badge">已划价</span> : String(item.status ?? '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </>
  );
}

function FollowUpDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanRow;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const [status, setStatus] = useState(String(plan.followUpStatus ?? 'NONE'));
  const [nextDate, setNextDate] = useState(String(plan.nextFollowUpAt ?? ''));
  const [note, setNote] = useState(String(plan.trackingNote ?? ''));
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest(`/treatment-plans/${plan.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify({
          followUpStatus: status,
          nextFollowUpAt: nextDate.trim() || undefined,
          trackingNote: note.trim() || undefined,
        }),
      });
      showToast('回访信息已保存', 'success');
      await onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '保存回访失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        回访状态
        <select aria-label="回访状态" value={status} onChange={(event) => setStatus(event.target.value)}>
          {Object.entries(FOLLOW_UP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        下次回访时间
        <input aria-label="下次回访时间" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
      </label>
      <label>
        回访备注
        <textarea aria-label="回访备注" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
      </div>
    </form>
  );
}

function PlanFormFields({
  form,
  update,
  editing,
  planId,
  onItemsLoaded,
}: {
  form: TreatmentPlanForm;
  update: (patch: Partial<TreatmentPlanForm>) => void;
  editing: boolean;
  planId: string | null;
  onItemsLoaded: () => void;
}) {
  const { showToast } = useToast();
  const [itemsLoading, setItemsLoading] = useState(false);
  // 效果只依赖 editing/planId（对话框每次打开组件都会重挂载），回调一律走 ref 避免陈旧闭包
  const updateRef = useRef(update);
  updateRef.current = update;
  const onItemsLoadedRef = useRef(onItemsLoaded);
  onItemsLoadedRef.current = onItemsLoaded;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // 编辑打开时异步回填明细行（formFromRow 是同步的，无法在其中 await）
  useEffect(() => {
    if (!editing || !planId) return;
    let cancelled = false;
    setItemsLoading(true);
    (async () => {
      try {
        const page = await apiRequest<Page<PlanItemRow>>(`/resources/treatmentPlanItems?planId=${planId}&page=1&pageSize=100`);
        if (cancelled) return;
        updateRef.current({
          items: page.items.map((row) => ({
            id: String(row.id),
            code: String(row.code ?? ''),
            name: String(row.name ?? ''),
            category: String(row.category ?? ''),
            price: row.price === null || row.price === undefined ? '' : (Number(row.price) / 100).toFixed(2),
            quantity: String(row.quantity ?? 1),
            teethNumbers: Array.isArray(row.teethNumbers) ? row.teethNumbers.map(String).join(', ') : '',
            status: String(row.status ?? 'PLANNED'),
            billed: Number(row.billed) === 1,
          })),
        });
      } catch (error) {
        if (!cancelled) showToastRef.current(errorMessage(error, '加载明细失败'), 'error');
      } finally {
        if (!cancelled) {
          setItemsLoading(false);
          onItemsLoadedRef.current();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [editing, planId]);

  function updateItem(id: string, patch: Partial<PlanItemForm>) {
    updateRef.current({ items: form.items.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) });
  }

  const doctors = useQuery({
    queryKey: ['plan-doctors'],
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
        计划名称
        <input value={form.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label>
        状态
        <input value={form.status} onChange={(event) => update({ status: event.target.value })} />
      </label>
      <label>
        总费用
        <input type="number" min="0" value={form.totalFee} onChange={(event) => update({ totalFee: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
      {itemsLoading && <p className="table-empty">明细加载中...</p>}
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          {item.billed && <span className="role-badge">已划价</span>}
          <input aria-label="明细名称" disabled={item.billed} value={item.name} placeholder="项目名称" onChange={(event) => updateItem(item.id, { name: event.target.value })} />
          <input aria-label="明细编码" disabled={item.billed} value={item.code} placeholder="编码" onChange={(event) => updateItem(item.id, { code: event.target.value })} />
          <input aria-label="明细类别" disabled={item.billed} value={item.category} placeholder="类别（如 种植/修复）" onChange={(event) => updateItem(item.id, { category: event.target.value })} />
          <input aria-label="明细单价" disabled={item.billed} type="number" min="0" value={item.price} placeholder="单价（元）" onChange={(event) => updateItem(item.id, { price: event.target.value })} />
          <input aria-label="明细数量" disabled={item.billed} type="number" min="1" value={item.quantity} placeholder="数量" onChange={(event) => updateItem(item.id, { quantity: event.target.value })} />
          <input aria-label="明细牙位" disabled={item.billed} value={item.teethNumbers} placeholder="牙位（逗号分隔，如 11,21）" onChange={(event) => updateItem(item.id, { teethNumbers: event.target.value })} />
          <input aria-label="明细状态" disabled={item.billed} value={item.status} placeholder="状态（如 PLANNED）" onChange={(event) => updateItem(item.id, { status: event.target.value })} />
          <button type="button" disabled={item.billed} onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
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

/**
 * 编辑提交：PATCH 主记录 + 明细 reconcile。
 * 以服务端当前明细为基准：有 id 且未变更 → 跳过；有 id 且已变更 → PATCH；
 * 表单中新增（无服务端 id）→ POST；服务端有而表单没有 → DELETE。
 * billed 保护：已划价明细（billed === true/1）不做 PATCH、不做 DELETE。
 */
async function updatePlanWithItems(form: TreatmentPlanForm, planId: string | null): Promise<void> {
  if (!planId) throw new Error('编辑目标不存在，请刷新后重试');
  const validEntries = form.items
    .filter((item) => item.name.trim() && item.price && item.quantity)
    .map((item) => ({ id: item.id, billed: item.billed, payload: buildItemPayload(item) }))
    .filter((entry) => entry.payload.price > 0 && entry.payload.quantity > 0);
  const calculatedFee = validEntries.reduce((sum, entry) => sum + entry.payload.price * entry.payload.quantity, 0);
  await apiRequest(`/resources/treatmentPlans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      patientId: form.patientId,
      doctorId: form.doctorId,
      name: form.name.trim(),
      status: form.status,
      totalFee: toCents(form.totalFee) || calculatedFee,
      remark: form.remark || undefined,
    }),
  });
  const page = await apiRequest<Page<PlanItemRow>>(`/resources/treatmentPlanItems?planId=${planId}&page=1&pageSize=100`);
  const serverItems = page.items ?? [];
  const serverById = new Map(serverItems.map((row) => [String(row.id), row]));
  const keptIds = new Set<string>();
  for (const entry of validEntries) {
    const existing = serverById.get(entry.id);
    if (!existing) {
      // 新增行（表单里无服务端 id 的行）
      await apiRequest('/resources/treatmentPlanItems', {
        method: 'POST',
        body: JSON.stringify({ planId, ...entry.payload }),
      });
      continue;
    }
    keptIds.add(entry.id);
    if (Number(existing.billed) === 1) continue; // billed 保护：不修改已划价明细
    if (isItemUnchanged(existing, entry.payload)) continue;
    await apiRequest(`/resources/treatmentPlanItems/${entry.id}`, {
      method: 'PATCH',
      body: JSON.stringify(entry.payload),
    });
  }
  for (const row of serverItems) {
    if (keptIds.has(String(row.id))) continue;
    if (Number(row.billed) === 1) continue; // billed 保护：不删除已划价明细
    await apiRequest(`/resources/treatmentPlanItems/${String(row.id)}`, { method: 'DELETE' });
  }
}

async function cleanupOrphanPlan(planId: string, createdItemIds: string[]): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/treatmentPlanItems/${itemId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`删除治疗计划明细失败（继续清理主记录）：${itemId}`, error);
    }
  }
  try {
    await apiRequest(`/resources/treatmentPlans/${planId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(`删除孤儿治疗计划失败：${planId}`, error);
  }
}
