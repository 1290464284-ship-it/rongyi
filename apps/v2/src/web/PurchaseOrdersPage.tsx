import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn, type SearchableSelectRow } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

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
  quantity: string;
  unitPrice: string;
}

interface PurchaseOrderForm {
  number: string;
  supplierId: string;
  items: PurchaseItemForm[];
}

function newItem(): PurchaseItemForm {
  return { id: crypto.randomUUID(), itemId: '', quantity: '1', unitPrice: '' };
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
      initialForm={emptyPurchaseForm}
      validate={(form) => {
        const validItems = buildValidItems(form.items, inventoryRows);
        if (!form.number.trim() || validItems.length === 0) {
          return '请填写采购单号并至少添加一条有效明细';
        }
        return null;
      }}
      submitOverride={async ({ form }) => {
        const validItems = buildValidItems(form.items, inventoryRows);
        await apiRequest('/purchase-orders', {
          method: 'POST',
          body: JSON.stringify({ number: form.number.trim(), supplierId: form.supplierId || undefined, items: validItems, requestId: crypto.randomUUID() }),
        });
      }}
      messages={{ create: '采购单已创建' }}
      errorMessages={{ create: '创建采购单失败' }}
      columns={purchaseColumns}
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
        <PurchaseOrderFormFields form={ctx.form} update={ctx.update} inventoryRows={inventoryRows} setInventoryRows={setInventoryRows} />
      )}
    />
  );
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
  inventoryRows,
  setInventoryRows,
}: {
  form: PurchaseOrderForm;
  update: (patch: Partial<PurchaseOrderForm>) => void;
  inventoryRows: SearchableSelectRow[];
  setInventoryRows: (rows: SearchableSelectRow[]) => void;
}) {
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
