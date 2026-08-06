import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn, type SearchableSelectRow } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import type { Page } from './types';

const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: '待提交',
  SUBMITTED: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
};

interface PurchaseRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  supplierId?: string | null;
  supplierIdLabel?: string | null;
  totalAmount?: number | null;
  status?: string | null;
  reviewStatus?: string | null;
  rejectionReason?: string | null;
}

interface PurchaseItemForm {
  id: string;
  itemId: string;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
}

interface PurchaseOrderItemRow extends Record<string, unknown> {
  id: string;
  itemId?: string | null;
  name?: string | null;
  spec?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  subtotal?: number | null;
}

interface PurchaseOrderForm {
  number: string;
  supplierId: string;
  items: PurchaseItemForm[];
}

function newItem(): PurchaseItemForm {
  return { id: crypto.randomUUID(), itemId: '', name: '', spec: '', quantity: '1', unitPrice: '', subtotal: '' };
}

function emptyPurchaseForm(): PurchaseOrderForm {
  return { number: '', supplierId: '', items: [newItem()] };
}

interface ValidPurchaseItem {
  itemId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

function buildValidItems(items: PurchaseItemForm[], inventoryRows: SearchableSelectRow[]): ValidPurchaseItem[] {
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

const purchaseColumns: DataTableColumn<PurchaseRow>[] = [
  { key: 'number', label: '采购单号' },
  { key: 'supplierId', label: '供应商', render: (row) => row.supplierIdLabel ?? row.supplierId ?? '' },
  { key: 'totalAmount', label: '金额', render: (row) => formatMoney(row.totalAmount) },
  { key: 'status', label: '状态' },
  {
    key: 'reviewStatus',
    label: '审核状态',
    render: (row) => {
      const status = String(row.reviewStatus ?? '');
      const label = REVIEW_STATUS_LABELS[status] ?? status;
      const reason = row.rejectionReason ? String(row.rejectionReason) : '';
      return (
        <span title={status === 'REJECTED' && reason ? `驳回原因：${reason}` : label}>
          {label}
          {status === 'REJECTED' && reason ? <span className="table-muted">{reason}</span> : null}
        </span>
      );
    },
  },
];

export function PurchaseOrdersPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const editingStatusRef = useRef<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [summaryTick, setSummaryTick] = useState(0);
  const [inventoryRows, setInventoryRows] = useState<SearchableSelectRow[]>([]);
  return (
    <CrudPage<PurchaseRow, PurchaseOrderForm>
      title="采购单管理"
      createLabel="新建采购单"
      emptyMessage="暂无采购单"
      queryKey={['purchase-orders']}
      endpoint="/resources/purchaseOrders"
      initialForm={() => {
        editingIdRef.current = null;
        editingStatusRef.current = null;
        return emptyPurchaseForm();
      }}
      formFromRow={(row) => {
        editingIdRef.current = String(row.id);
        editingStatusRef.current = String(row.status ?? '');
        return {
          number: String(row.number ?? ''),
          supplierId: String(row.supplierId ?? ''),
          items: [newItem()],
        };
      }}
      validate={(form) => {
        const validItems = buildValidItems(form.items, inventoryRows);
        if (!form.number.trim() || validItems.length === 0) {
          return '请填写采购单号并至少添加一条有效明细';
        }
        return null;
      }}
      submitOverride={async ({ form, editing }) => {
        const validItems = buildValidItems(form.items, inventoryRows);
        // 已选择物料或填写了单价但数量/单价无效的明细会被静默丢弃，提交前提示
        const dropped = form.items
          .filter((item) => Boolean(item.itemId) || item.unitPrice.trim() !== '')
          .length - validItems.length;
        if (dropped > 0) showToast(`${dropped} 条明细因数量或单价无效将被忽略`, 'info');
        if (editing) {
          const orderId = editingIdRef.current;
          if (!orderId) throw new Error('缺少编辑记录 ID');
          const totalAmount = validItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
          await apiRequest(`/resources/purchaseOrders/${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              number: form.number.trim(),
              supplierId: form.supplierId || undefined,
              totalAmount,
              status: editingStatusRef.current ?? 'PENDING',
            }),
          });
          await reconcilePurchaseItems(orderId, form.items, inventoryRows);
          return;
        }
        await apiRequest('/purchase-orders', {
          method: 'POST',
          body: JSON.stringify({ number: form.number.trim(), supplierId: form.supplierId || undefined, items: validItems, requestId: crypto.randomUUID() }),
        });
      }}
      messages={{ create: '采购单已创建', update: '采购单已更新', delete: '采购单已删除' }}
      errorMessages={{ create: '创建采购单失败', update: '更新采购单失败', delete: '删除采购单失败' }}
      columns={purchaseColumns}
      canEdit
      canDelete
      extraHeaderActions={<ReviewSummaryBar refreshKey={summaryTick} />}
      rowActions={(row, ctx) => (
        <>
          <ReviewRowActions
            row={row}
            reviewing={reviewing}
            setReviewing={setReviewing}
            reload={ctx.reload}
            showToast={showToast}
            onChanged={() => setSummaryTick((tick) => tick + 1)}
          />
          {/* 收货门禁：仅审核已通过（APPROVED）且未收货（PENDING）可收货；服务端同样校验 */}
          <button
            disabled={String(row.reviewStatus) !== 'APPROVED' || String(row.status) !== 'PENDING' || receiving}
            onClick={() => void receivePurchase(showToast, ctx.reload, setReceiving, row.id, () => setSummaryTick((tick) => tick + 1))}
          >
            收货
          </button>
        </>
      )}
      renderForm={(ctx) => (
        <PurchaseOrderFormFields
          form={ctx.form}
          update={ctx.update}
          inventoryRows={inventoryRows}
          setInventoryRows={setInventoryRows}
          editing={ctx.editing}
          editingId={editingIdRef.current}
        />
      )}
    />
  );
}

/** 编辑保存时的明细 reconcile：有 id 的行 PATCH，新行 POST（带 orderId），被移除的行 DELETE。 */
async function reconcilePurchaseItems(
  orderId: string,
  items: PurchaseItemForm[],
  inventoryRows: SearchableSelectRow[],
): Promise<void> {
  const existing = await apiRequest<Page<PurchaseOrderItemRow>>(
    `/resources/purchaseOrderItems?orderId=${orderId}&page=1&pageSize=100`,
  );
  const existingById = new Map(existing.items.map((row) => [String(row.id), row]));
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
        }),
      });
    }
  }
  for (const row of existing.items) {
    if (!keptIds.has(String(row.id))) {
      await apiRequest(`/resources/purchaseOrderItems/${String(row.id)}`, { method: 'DELETE' });
    }
  }
}

/** 采购单审核汇总条：待审核（SUBMITTED）/ 待收货（APPROVED）计数。 */
function ReviewSummaryBar({ refreshKey }: { refreshKey: number }) {
  const query = useQuery({
    queryKey: ['purchase-orders-review-stats', refreshKey],
    queryFn: async () => {
      const data = await apiRequest<Record<string, unknown>>('/purchase-orders/review-stats');
      return {
        submitted: Number(data?.submitted ?? 0),
        approved: Number(data?.approved ?? 0),
      };
    },
  });
  return (
    <div className="tracking-overview" aria-label="采购审核汇总">
      <span className="tracking-chip">待审核 {query.data?.submitted ?? 0} 单</span>
      <span className="tracking-chip">待收货 {query.data?.approved ?? 0} 单</span>
    </div>
  );
}

function ReviewRowActions({
  row,
  reviewing,
  setReviewing,
  reload,
  showToast,
  onChanged,
}: {
  row: PurchaseRow;
  reviewing: boolean;
  setReviewing: (value: boolean) => void;
  reload: () => Promise<unknown>;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  onChanged: () => void;
}) {
  const reviewStatus = String(row.reviewStatus ?? '');
  if (reviewStatus === 'PENDING') {
    return (
      <button
        disabled={reviewing}
        onClick={() => void reviewAction(showToast, reload, setReviewing, onChanged, row.id, 'submit', '已提交审核')}
      >
        提交审核
      </button>
    );
  }
  if (reviewStatus === 'SUBMITTED') {
    return (
      <span>
        <button
          disabled={reviewing}
          onClick={() => void reviewAction(showToast, reload, setReviewing, onChanged, row.id, 'approve', '已通过审核')}
        >
          通过
        </button>
        <button disabled={reviewing} onClick={() => void rejectOrder(showToast, reload, setReviewing, onChanged, row.id)}>
          驳回
        </button>
      </span>
    );
  }
  if (reviewStatus === 'REJECTED') {
    return (
      <button
        disabled={reviewing}
        onClick={() => void reviewAction(showToast, reload, setReviewing, onChanged, row.id, 'reopen', '已重新提交')}
      >
        重新提交
      </button>
    );
  }
  return null;
}

async function reviewAction(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  setReviewing: (value: boolean) => void,
  onChanged: () => void,
  id: string,
  action: string,
  successMessage: string,
  body?: Record<string, unknown>,
) {
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

function rejectOrder(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  setReviewing: (value: boolean) => void,
  onChanged: () => void,
  id: string,
) {
  const reason = window.prompt('请输入驳回原因', '');
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('驳回原因必填', 'error');
    return;
  }
  void reviewAction(showToast, reload, setReviewing, onChanged, id, 'reject', '已驳回', { reason: reason.trim() });
}

async function receivePurchase(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  setReceiving: (value: boolean) => void,
  id: string,
  onChanged?: () => void,
) {
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

function PurchaseOrderFormFields({
  form,
  update,
  inventoryRows: _inventoryRows,
  setInventoryRows,
  editing,
  editingId,
}: {
  form: PurchaseOrderForm;
  update: (patch: Partial<PurchaseOrderForm>) => void;
  inventoryRows: SearchableSelectRow[];
  setInventoryRows: (rows: SearchableSelectRow[]) => void;
  editing: boolean;
  editingId: string | null;
}) {
  const loadedItemsForRef = useRef<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing || !editingId || loadedItemsForRef.current === editingId) return;
    let cancelled = false;
    loadedItemsForRef.current = editingId;
    setItemsError(null);
    apiRequest<Page<PurchaseOrderItemRow>>(`/resources/purchaseOrderItems?orderId=${editingId}&page=1&pageSize=100`)
      .then((data) => {
        if (cancelled) return;
        update({
          items: (data.items ?? []).map((row) => ({
            id: String(row.id),
            itemId: String(row.itemId ?? ''),
            name: String(row.name ?? ''),
            spec: String(row.spec ?? ''),
            quantity: String(row.quantity ?? '1'),
            unitPrice: (Number(row.unitPrice ?? 0) / 100).toFixed(2),
            subtotal: (Number(row.subtotal ?? 0) / 100).toFixed(2),
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setItemsError('明细加载失败，请关闭后重试');
      });
    return () => {
      cancelled = true;
    };
  }, [editing, editingId, update]);
  return (
    <>
      <label>
        采购单号
        <input value={form.number} onChange={(event) => update({ number: event.target.value })} />
      </label>
      <label>
        供应商
        <SearchableSelect
          resource="suppliers"
          value={form.supplierId}
          onChange={(id) => update({ supplierId: id })}
          ariaLabel="供应商"
          placeholder="不指定"
        />
      </label>
      {itemsError && <p className="error">{itemsError}</p>}
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <SearchableSelect
            resource="inventoryItems"
            value={item.itemId}
            onChange={(id) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, itemId: id } : entry) })}
            ariaLabel="采购项目"
            placeholder="选择项目"
            onLoaded={(rows) => setInventoryRows(rows)}
          />
          <input aria-label="采购数量" type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
          <input aria-label="采购单价" type="number" min="0" value={item.unitPrice} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, unitPrice: event.target.value } : entry) })} />
          <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
    </>
  );
}
