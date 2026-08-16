import { toCents } from '../lib/format';
import { reconcileItems } from '../lib/reconcile';
import type { ProcessingItemForm, ProcessingOrderForm } from './types';

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

/** 编辑保存时的明细 reconcile：有 id 的行 PATCH，新行 POST（带 orderId），被移除的行 DELETE。 */
export async function reconcileProcessingItems(orderId: string, items: ProcessingItemForm[]): Promise<void> {
  await reconcileItems({
    endpoint: '/resources/processingOrderItems',
    orderId,
    items,
    isValid: (item) => Boolean(item.name.trim()) && Boolean(item.quantity) && Boolean(item.unitPrice),
    toPatch: (item) => ({
      name: item.name.trim(),
      spec: item.spec.trim() || undefined,
      status: item.status || 'DRAFT',
    }),
    toPost: (item) => ({
      name: item.name.trim(),
      spec: item.spec.trim() || undefined,
      status: 'DRAFT',
    }),
  });
}
