import { useState, type FormEvent, type ReactNode } from 'react';
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
  name?: string | null;
  category?: string | null;
  price?: number | null;
  quantity?: number | null;
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
  return { id: crypto.randomUUID(), code: '', name: '', category: '', price: '', quantity: '1', teethNumbers: '', status: 'PLANNED' };
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

function buildValidItems(items: PlanItemForm[]): ValidPlanItem[] {
  return items
    .filter((item) => item.name.trim() && item.price && item.quantity)
    .map((item) => ({
      code: item.code || `ITEM-${Date.now()}`,
      name: item.name.trim(),
      category: item.category || 'GENERAL',
      price: toCents(item.price),
      quantity: Number(item.quantity),
      teethNumbers: splitList(item.teethNumbers),
      status: item.status,
    }))
    .filter((item) => item.price > 0 && item.quantity > 0);
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
        initialForm={emptyPlanForm}
        validate={(form) => {
          const validItems = buildValidItems(form.items);
          if (!form.patientId || !form.doctorId || !form.name.trim() || validItems.length === 0) {
            return '请选择患者、医生并填写计划名称和至少一条有效明细';
          }
          return null;
        }}
        submitOverride={async ({ form }) => {
          const validItems = buildValidItems(form.items);
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
        messages={{ create: '治疗计划已创建' }}
        errorMessages={{ create: '创建治疗计划失败' }}
        columns={planColumns}
        rowActions={(row, ctx) => (
          <>
            <button onClick={() => setBillingTarget({ row, reload: ctx.reload })}>折扣</button>
            <button onClick={() => setFollowUpTarget({ row, reload: ctx.reload })}>回访</button>
            <button onClick={() => void requestPrint(row, showToast, ctx.reload, setPrintResult)}>打印</button>
            <button onClick={() => setSignTarget({ row, reload: ctx.reload })}>签字</button>
          </>
        )}
        renderForm={(ctx) => <PlanFormFields form={ctx.form} update={ctx.update} />}
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

function PlanFormFields({ form, update }: { form: TreatmentPlanForm; update: (patch: Partial<TreatmentPlanForm>) => void }) {
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
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <input aria-label="明细名称" value={item.name} placeholder="项目名称" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} />
          <input aria-label="明细编码" value={item.code} placeholder="编码" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, code: event.target.value } : entry) })} />
          <input aria-label="明细单价" type="number" min="0" value={item.price} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, price: event.target.value } : entry) })} />
          <input aria-label="明细数量" type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
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
