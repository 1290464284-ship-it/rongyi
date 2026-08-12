import { toCents } from '../lib/format';
import type { PurchaseItemForm, PurchaseOrderForm, ValidPurchaseItem } from './types';

export function newItem(): PurchaseItemForm {
  return { id: crypto.randomUUID(), itemId: '', name: '', spec: '', quantity: '1', unitPrice: '', subtotal: '' };
}

export function emptyPurchaseForm(): PurchaseOrderForm {
  return { number: '', supplierId: '', items: [newItem()] };
}

export function buildValidItems(items: PurchaseItemForm[]): ValidPurchaseItem[] {
  return items
    .filter((item) => item.quantity && item.unitPrice)
    .map((item) => {
      const matchedName = item.itemId ? (item.name.trim() || '自定义项目').trim() : '';
      return {
        itemId: item.itemId || undefined,
        name: item.itemId ? (matchedName || '自定义项目') : '自定义项目',
        quantity: Number(item.quantity),
        unitPrice: toCents(item.unitPrice),
      };
    })
    .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
}
