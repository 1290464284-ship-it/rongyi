import { apiRequest, fetchAllPages } from '../lib/api';
import { toCents } from '../lib/format';
import { errorMessage } from '../lib/messages';
import type { ToastKind } from '../lib/toast-context';
import type { SearchableSelectRow } from '../components';
import type { PurchaseItemForm, PurchaseOrderItemRow } from './types';

/** 编辑保存时的明细 reconcile：有 id 的行 PATCH，新行 POST（带 orderId），被移除的行 DELETE。 */
export async function reconcilePurchaseItems(
  orderId: string,
  items: PurchaseItemForm[],
  inventoryRows: SearchableSelectRow[],
): Promise<void> {
  const existing = await fetchAllPages<PurchaseOrderItemRow>(
    `/resources/purchaseOrderItems?orderId=${orderId}`,
  );
  const existingById = new Map(existing.map((row) => [String(row.id), row]));
  const keptIds = new Set<string>();
  for (const item of items) {
    if (!item.quantity || !item.unitPrice) continue;
    const quantity = Number(item.quantity);
    const unitPrice = toCents(item.unitPrice);
    if (!(quantity > 0) || !(unitPrice >= 0)) continue;
    if (item.id && existingById.has(item.id)) {
      keptIds.add(item.id);
      await apiRequest(`/resources/purchaseOrderItems/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          itemId: item.itemId || undefined,
          name: item.name.trim() || '自定义项目',
          spec: item.spec.trim() || undefined,
          quantity,
          unitPrice,
          subtotal: Math.round(unitPrice * quantity),
        }),
      });
    } else {
      await apiRequest('/resources/purchaseOrderItems', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          itemId: item.itemId || undefined,
          name: item.itemId ? String(inventoryRows.find((row) => String(row.id) === item.itemId)?.name ?? '') : '自定义项目',
          spec: item.spec.trim() || undefined,
          quantity,
          unitPrice,
          subtotal: Math.round(unitPrice * quantity),
          requestId: crypto.randomUUID(),
        }),
      });
    }
  }
  for (const row of existing) {
    if (!keptIds.has(String(row.id))) {
      await apiRequest(`/resources/purchaseOrderItems/${String(row.id)}`, { method: 'DELETE' });
    }
  }
}

export async function reviewAction(
  showToast: (message: string, kind?: ToastKind) => void,
  reload: () => Promise<unknown>,
  setReviewing: (value: boolean) => void,
  onChanged: () => void,
  id: string,
  action: string,
  successMessage: string,
  body?: Record<string, unknown>,
): Promise<void> {
  setReviewing(true);
  try {
    await apiRequest(`/purchase-orders/${id}/${action}`, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    showToast(successMessage, 'success');
    await reload();
    onChanged();
  } catch (error) {
    showToast(errorMessage(error, '操作失败，请稍后重试'), 'error');
  } finally {
    setReviewing(false);
  }
}

export async function receivePurchase(
  showToast: (message: string, kind?: ToastKind) => void,
  reload: () => Promise<unknown>,
  setReceiving: (value: boolean) => void,
  id: string,
  onChanged?: () => void,
): Promise<void> {
  setReceiving(true);
  try {
    await apiRequest(`/purchase-orders/${id}/receive`, { method: 'PATCH' });
    showToast('采购单已收货', 'success');
    await reload();
    onChanged?.();
  } catch (error) {
    showToast(errorMessage(error, '收货失败'), 'error');
  } finally {
    setReceiving(false);
  }
}
