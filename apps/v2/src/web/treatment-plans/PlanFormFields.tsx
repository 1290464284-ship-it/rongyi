import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, fetchAllPages } from '../lib/api';
import { MissingSelectOption, SearchableSelect } from '../components';
import { centsToYuanString } from '../lib/format';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import type { PlanItemForm, PlanItemRow, TreatmentPlanForm } from './types';
import { newItem } from './plan-utils';

export function PlanFormFields({
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
  // loading 派生：编辑打开且明细尚未加载完成；加载完成后 setItemsLoaded(true)
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const itemsLoading = editing && Boolean(planId) && !itemsLoaded;
  // 效果只依赖 editing/planId（对话框每次打开组件都会重挂载），回调一律走 ref 避免陈旧闭包；
  // ref 在 effect 中更新（每次渲染后），回填 effect 按声明顺序在其后执行，读到的是最新值
  const updateRef = useRef(update);
  const onItemsLoadedRef = useRef(onItemsLoaded);
  const showToastRef = useRef(showToast);
  useEffect(() => { updateRef.current = update; });
  useEffect(() => { onItemsLoadedRef.current = onItemsLoaded; });
  useEffect(() => { showToastRef.current = showToast; });

  // 编辑打开时异步回填明细行（formFromRow 是同步的，无法在其中 await）
  useEffect(() => {
    if (!editing || !planId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchAllPages<PlanItemRow>(`/resources/treatmentPlanItems?planId=${planId}`);
        if (cancelled) return;
        updateRef.current({
          items: rows.map((row) => ({
            id: String(row.id),
            code: String(row.code ?? ''),
            name: String(row.name ?? ''),
            category: String(row.category ?? ''),
            price: centsToYuanString(row.price),
            quantity: String(row.quantity ?? 1),
            teethNumbers: Array.isArray(row.teethNumbers) ? row.teethNumbers.map(String).join(', ') : '',
            status: String(row.status ?? 'PLANNED'),
            billed: Number(row.billed) === 1,
          })),
        });
        setItemsLoaded(true);
        onItemsLoadedRef.current();
      } catch (error) {
        if (!cancelled) {
          setItemsError(errorMessage(error, '加载明细失败'));
          showToastRef.current(errorMessage(error, '加载明细失败'), 'error');
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
          {form.doctorId !== '' && !(doctors.data ?? []).some((row) => String(row.id) === form.doctorId) && (
            <MissingSelectOption value={form.doctorId} />
          )}
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
      {itemsError && <p className="error">{itemsError}</p>}
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          {item.billed && <span className="role-badge">已划价</span>}
          <input aria-label="明细名称" disabled={item.billed || itemsLoading} value={item.name} placeholder="项目名称" onChange={(event) => updateItem(item.id, { name: event.target.value })} />
          <input aria-label="明细编码" disabled={item.billed || itemsLoading} value={item.code} placeholder="编码" onChange={(event) => updateItem(item.id, { code: event.target.value })} />
          <input aria-label="明细类别" disabled={item.billed || itemsLoading} value={item.category} placeholder="类别（如 种植/修复）" onChange={(event) => updateItem(item.id, { category: event.target.value })} />
          <input aria-label="明细单价" disabled={item.billed || itemsLoading} type="number" min="0" value={item.price} placeholder="单价（元）" onChange={(event) => updateItem(item.id, { price: event.target.value })} />
          <input aria-label="明细数量" disabled={item.billed || itemsLoading} type="number" min="1" value={item.quantity} placeholder="数量" onChange={(event) => updateItem(item.id, { quantity: event.target.value })} />
          <input aria-label="明细牙位" disabled={item.billed || itemsLoading} value={item.teethNumbers} placeholder="牙位（逗号分隔，如 11,21）" onChange={(event) => updateItem(item.id, { teethNumbers: event.target.value })} />
          <input aria-label="明细状态" disabled={item.billed || itemsLoading} value={item.status} placeholder="状态（如 PLANNED）" onChange={(event) => updateItem(item.id, { status: event.target.value })} />
          <button type="button" disabled={item.billed || itemsLoading} onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" disabled={itemsLoading} onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
    </>
  );
}
