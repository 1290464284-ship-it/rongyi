import { apiRequest } from '../api';
import { toCents } from '../format';
import type { Page } from '../types';
import type { PlanItemForm, PlanItemRow, TreatmentPlanForm, ValidPlanItem } from './plan-types';

export function newItem(): PlanItemForm {
  return { id: crypto.randomUUID(), code: '', name: '', category: '', price: '', quantity: '1', teethNumbers: '', status: 'PLANNED', billed: false };
}

export function emptyPlanForm(): TreatmentPlanForm {
  return { patientId: '', doctorId: '', name: '', status: 'APPROVED', totalFee: '', remark: '', items: [newItem()] };
}

export function buildItemPayload(item: PlanItemForm): ValidPlanItem {
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

/** 服务端明细行与表单 payload 是否完全一致（一致则编辑保存时跳过 PATCH）。 */
export function isItemUnchanged(row: PlanItemRow, payload: ValidPlanItem): boolean {
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

export function splitList(value: string): string[] {
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
export async function updatePlanWithItems(form: TreatmentPlanForm, planId: string | null): Promise<void> {
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

export async function cleanupOrphanPlan(planId: string, createdItemIds: string[]): Promise<void> {
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
