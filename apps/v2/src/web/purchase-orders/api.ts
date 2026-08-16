import { apiRequest } from '../lib/api';
import { errorMessage } from '../lib/messages';
import type { ToastKind } from '../lib/toast-context';
import { reconcileItems } from '../lib/reconcile';
import type { PurchaseItemForm } from './types';

/** 编辑保存时的明细 reconcile：有 id 的行 PATCH，新行 POST（带 orderId），被移除的行 DELETE。 */
export async function reconcilePurchaseItems(
  orderId: string,
  items: PurchaseItemForm[],
): Promise<void> {
  await reconcileItems({
    endpoint: '/resources/purchaseOrderItems',
    orderId,
    items,
    isValid: (item) => Boolean(item.quantity) && Boolean(item.unitPrice),
    toPatch: (item) => ({
      itemId: item.itemId || undefined,
      name: item.name.trim() || '自定义项目',
      spec: item.spec.trim() || undefined,
    }),
    toPost: (item) => ({
      itemId: item.itemId || undefined,
      name: item.itemId ? (item.name.trim() || '自定义项目') : '自定义项目',
      spec: item.spec.trim() || undefined,
    }),
  });
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
