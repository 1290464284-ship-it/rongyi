import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { LoadingState, PageError } from '../components';
import { formatMoney } from '../format';
import { errorMessage } from '../messages';
import { useToast } from '../toast-context';
import type { Page } from '../types';
import { PLAN_DISCOUNT_LABELS, type PlanItemRow, type PlanRow } from './plan-types';

export function PlanBillingDialog({
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
