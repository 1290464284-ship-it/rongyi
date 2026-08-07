import { apiRequest, fetchAllPages } from '../lib/api';
import { toCents } from '../lib/format';
import type { ProcessingItemForm, ProcessingOrderForm, ProcessingOrderItemRow } from './types';

export function newItem(): ProcessingItemForm {
  return { id: crypto.randomUUID(), name: '', spec: '', quantity: '1', unitPrice: '', subtotal: '', status: 'DRAFT' };
}

export function emptyProcessingForm(): ProcessingOrderForm {
  return { patientId: '', doctorId: '', number: '', shade: '', teethNumbers: '', totalFee: '', items: [newItem()] };
}

export interface ValidProcessingItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export function buildValidItems(items: ProcessingItemForm[]): ValidProcessingItem[] {
  return items
    .filter((item) => item.name.trim() && item.quantity && item.unitPrice)
    .map((item) => ({
      name: item.name.trim(),
      quantity: Number(item.quantity),
      unitPrice: toCents(item.unitPrice),
    }))
    .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
}

export function joinList(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function validFormItems(items: ProcessingItemForm[]): ProcessingItemForm[] {
  return items.filter((item) => {
    if (!item.name.trim() || !item.quantity || !item.unitPrice) return false;
    return Number(item.quantity) > 0 && toCents(item.unitPrice) >= 0;
  });
}

/** 编辑保存时的明细 reconcile：有 id 的行 PATCH，新行 POST（带 orderId），被移除的行 DELETE。 */
export async function reconcileProcessingItems(orderId: string, items: ProcessingItemForm[]): Promise<void> {
  const existing = await fetchAllPages<ProcessingOrderItemRow>(
    `/resources/processingOrderItems?orderId=${orderId}`,
  );
  const existingById = new Map(existing.map((row) => [String(row.id), row]));
  const keptIds = new Set<string>();
  for (const item of validFormItems(items)) {
    const quantity = Number(item.quantity);
    const unitPrice = toCents(item.unitPrice);
    if (item.id && existingById.has(item.id)) {
      keptIds.add(item.id);
      await apiRequest(`/resources/processingOrderItems/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: item.name.trim(),
          spec: item.spec.trim() || undefined,
          quantity,
          unitPrice,
          subtotal: Math.round(unitPrice * quantity),
          status: item.status || 'DRAFT',
        }),
      });
    } else {
      await apiRequest('/resources/processingOrderItems', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          name: item.name.trim(),
          spec: item.spec.trim() || undefined,
          quantity,
          unitPrice,
          subtotal: Math.round(unitPrice * quantity),
          status: 'DRAFT',
          requestId: crypto.randomUUID(),
        }),
      });
    }
  }
  for (const row of existing) {
    if (!keptIds.has(String(row.id))) {
      await apiRequest(`/resources/processingOrderItems/${String(row.id)}`, { method: 'DELETE' });
    }
  }
}
