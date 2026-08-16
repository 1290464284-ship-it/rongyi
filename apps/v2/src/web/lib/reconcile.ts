import { apiRequest, fetchAllPages } from './api';
import { toCents } from './format';

/**
 * 编辑保存时的明细对账公共实现：
 * 拉取现有明细 → 逐行按 id 对账（有 id PATCH / 新行 POST / 被移除行 DELETE）。
 * 采购单与加工单此前各自手写同一套流程，现收敛为单一泛型函数；
 * 两处不同的校验规则与载荷字段通过 isValid / toPatch / toPost 回调保留。
 */
export interface ReconcileItem {
  id?: string | null;
  quantity: string;
  unitPrice: string;
}

export interface ReconcileOptions<T extends ReconcileItem> {
  /** 明细资源集合路径，例如 `/resources/purchaseOrderItems`。 */
  endpoint: string;
  /** 归属订单 id，用于拉取现有明细（`?orderId=`）。 */
  orderId: string;
  /** 表单中的目标明细。 */
  items: T[];
  /** 判定某行是否应写入；缺省全部通过。 */
  isValid?: (item: T) => boolean;
  /** PATCH 时除 quantity/unitPrice/subtotal 外的额外载荷。 */
  toPatch?: (item: T) => Record<string, unknown>;
  /** POST 时除 orderId/quantity/unitPrice/subtotal/requestId 外的额外载荷。 */
  toPost?: (item: T) => Record<string, unknown>;
}

export async function reconcileItems<T extends ReconcileItem>(options: ReconcileOptions<T>): Promise<void> {
  const existing = await fetchAllPages<{ id?: string | null }>(`${options.endpoint}?orderId=${options.orderId}`);
  const existingById = new Map(existing.map((row) => [String(row.id), row]));
  const keptIds = new Set<string>();
  const toPatch = options.toPatch ?? (() => ({}));
  const toPost = options.toPost ?? (() => ({}));

  for (const item of options.items) {
    if (options.isValid && !options.isValid(item)) continue;
    const quantity = Number(item.quantity);
    const unitPrice = toCents(item.unitPrice);
    if (!(quantity > 0) || !(unitPrice >= 0)) continue;
    const subtotal = Math.round(unitPrice * quantity);
    if (item.id && existingById.has(String(item.id))) {
      keptIds.add(String(item.id));
      await apiRequest(`${options.endpoint}/${String(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...toPatch(item), quantity, unitPrice, subtotal }),
      });
    } else {
      await apiRequest(options.endpoint, {
        method: 'POST',
        body: JSON.stringify({ orderId: options.orderId, ...toPost(item), quantity, unitPrice, subtotal, requestId: crypto.randomUUID() }),
      });
    }
  }
  for (const row of existing) {
    if (!keptIds.has(String(row.id))) {
      await apiRequest(`${options.endpoint}/${String(row.id)}`, { method: 'DELETE' });
    }
  }
}
