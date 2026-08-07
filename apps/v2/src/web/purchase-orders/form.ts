import { toCents } from '../lib/format';
import type { SearchableSelectRow } from '../components';
import type { PurchaseItemForm, PurchaseOrderForm, ValidPurchaseItem } from './types';

export function newItem(): PurchaseItemForm {
  return { id: crypto.randomUUID(), itemId: '', name: '', spec: '', quantity: '1', unitPrice: '', subtotal: '' };
}

export function emptyPurchaseForm(): PurchaseOrderForm {
  return { number: '', supplierId: '', items: [newItem()] };
}

export function buildValidItems(items: PurchaseItemForm[], inventoryRows: SearchableSelectRow[]): ValidPurchaseItem[] {
  return items
    .filter((item) => item.quantity && item.unitPrice)
    .map((item) => ({
      itemId: item.itemId || undefined,
      name: item.itemId ? String(inventoryRows.find((row) => String(row.id) === item.itemId)?.name ?? '') : '自定义项目',
      quantity: Number(item.quantity),
      unitPrice: toCents(item.unitPrice),
    }))
    .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
}
