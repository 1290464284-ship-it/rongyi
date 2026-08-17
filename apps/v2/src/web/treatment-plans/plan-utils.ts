import { apiRequest } from '../lib/api';
import { splitList, toCents } from '../lib/format';
import type { PlanItemForm, TreatmentPlanForm, ValidPlanItem } from './types';

export function newItem(): PlanItemForm {
  return { id: crypto.randomUUID(), code: '', name: '', category: '', price: '', quantity: '1', teethNumbers: '', status: 'PLANNED', billed: false };
}

export function emptyPlanForm(): TreatmentPlanForm {
  return { patientId: '', doctorId: '', name: '', status: 'APPROVED', totalFee: '', totalFeeConfirmed: false, remark: '', items: [newItem()] };
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

export function buildValidItems(items: PlanItemForm[]): ValidPlanItem[] {
  return items
    .filter((item) => item.name.trim() && item.price && item.quantity)
    .map(buildItemPayload)
    .filter((item) => item.price > 0 && item.quantity > 0);
}

/**
 * 编辑提交：PATCH 主记录 + 明细 reconcile。
 * 以服务端当前明细为基准：有 id 且未变更 → 跳过；有 id 且已变更 → PATCH；
 * 表单中新增（无服务端 id）→ POST；服务端有而表单没有 → DELETE。
 * billed 保护：已划价明细（billed === true/1）不做 PATCH、不做 DELETE。
 */
export async function updatePlanWithItems(form: TreatmentPlanForm, planId: string | null): Promise<void> {
  if (!planId) throw new Error('编辑目标不存在，请刷新后重试');
  const validEntries = form.items
    .filter((item) => item.name.trim() && item.price && item.quantity)
    .map((item) => ({ id: item.id, billed: item.billed, payload: buildItemPayload(item) }))
    .filter((entry) => entry.payload.price > 0 && entry.payload.quantity > 0);
  const calculatedFee = validEntries.reduce((sum, entry) => sum + entry.payload.price * entry.payload.quantity, 0);
  await apiRequest(`/treatment-plans/${planId}/save`, {
    method: 'PATCH',
    body: JSON.stringify({
      patientId: form.patientId,
      doctorId: form.doctorId,
      name: form.name.trim(),
      status: form.status,
      totalFee: toCents(form.totalFee) || calculatedFee,
      totalFeeConfirmed: Boolean(form.totalFeeConfirmed),
      remark: form.remark || undefined,
      items: validEntries.map((entry) => ({
        id: entry.id || undefined,
        ...entry.payload,
      })),
    }),
  });
}

export async function cleanupOrphanPlan(
  planId: string,
  createdItemIds: string[],
  showToast?: (message: string, kind?: 'success' | 'error' | 'info') => void,
): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/treatmentPlanItems/${itemId}`, { method: 'DELETE' });
    } catch {
      showToast?.(`删除治疗计划明细 ${itemId} 失败，请检查未完成数据`, 'error');
    }
  }
  try {
    await apiRequest(`/resources/treatmentPlans/${planId}`, { method: 'DELETE' });
  } catch {
    showToast?.(`删除孤儿治疗计划 ${planId} 失败，请检查未完成数据`, 'error');
  }
}
