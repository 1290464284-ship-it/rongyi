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
        // matchedName 在 itemId 非空时恒为 (item.name.trim() || '自定义项目').trim()，必为非空字符串，`|| '自定义项目'` 为死代码，已删除。
        name: item.itemId ? matchedName : '自定义项目',
        quantity: Number(item.quantity),
        unitPrice: toCents(item.unitPrice),
      };
    })
    .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
}
