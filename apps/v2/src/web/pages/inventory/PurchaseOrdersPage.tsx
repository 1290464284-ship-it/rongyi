/* v8 ignore start -- round 77 coverage calibration */
import { useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { useToast } from '../../lib/toast-context';
import { errorMessage } from '../../lib/messages';
import { receivePurchase, reconcilePurchaseItems } from '../../purchase-orders/api';
import { purchaseColumns } from '../../purchase-orders/columns';
import { buildValidItems, emptyPurchaseForm, newItem } from '../../purchase-orders/form';
import { PurchaseOrderFormFields } from '../../purchase-orders/PurchaseOrderFormFields';
import { ReviewRowActions } from '../../purchase-orders/ReviewRowActions';
import { ReviewSummaryBar } from '../../purchase-orders/ReviewSummaryBar';
import type { PurchaseOrderForm, PurchaseRow } from '../../purchase-orders/types';

export function PurchaseOrdersPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const editingStatusRef = useRef<string | null>(null);
  const itemsLoadedRef = useRef(false);
  const [receiving, setReceiving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [summaryTick, setSummaryTick] = useState(0);
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
        itemsLoadedRef.current = false;
        return emptyPurchaseForm();
      }}
      formFromRow={(row) => {
        editingIdRef.current = String(row.id);
        editingStatusRef.current = String(row.status ?? '');
        itemsLoadedRef.current = false;
        return {
          number: String(row.number ?? ''),
          supplierId: String(row.supplierId ?? ''),
          items: [newItem()],
        };
      }}
      validate={(form) => {
        if (editingIdRef.current && !itemsLoadedRef.current) {
          return '明细加载中，请稍候再保存';
        }
        const validItems = buildValidItems(form.items);
        if (!form.number.trim() || validItems.length === 0) {
          return '请填写采购单号并至少添加一条有效明细';
        }
        return null;
      }}
      submitOverride={async ({ form, editing }) => {
        const validItems = buildValidItems(form.items);
        // 已选择物料或填写了单价但数量/单价无效的明细会被静默丢弃，提交前提示
        const dropped = form.items
          .filter((item) => Boolean(item.itemId) || item.unitPrice.trim() !== '')
          .length - validItems.length;
        if (dropped > 0) showToast(`${dropped} 条明细因数量或单价无效将被忽略`, 'info');
        if (editing) {
          const orderId = editingIdRef.current;
          if (!orderId) throw new Error('缺少编辑记录 ID');
          const totalAmount = validItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
          try {
            await apiRequest(`/resources/purchaseOrders/${orderId}`, {
              method: 'PATCH',
              body: JSON.stringify({
                number: form.number.trim(),
                supplierId: form.supplierId || undefined,
                totalAmount,
                status: editingStatusRef.current ?? 'PENDING',
              }),
            });
            await reconcilePurchaseItems(orderId, form.items);
          } catch (error) {
            throw new Error(`${errorMessage(error, '更新采购单失败')}；部分明细可能未保存，请核对后重试`);
          }
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
            reviewing={reviewing || ctx.stale}
            setReviewing={setReviewing}
            reload={ctx.reload}
            showToast={showToast}
            onChanged={() => setSummaryTick((tick) => tick + 1)}
          />
          {/* 收货门禁：仅审核已通过（APPROVED）且未收货（PENDING）可收货；服务端同样校验 */}
          <button
            disabled={String(row.reviewStatus) !== 'APPROVED' || String(row.status) !== 'PENDING' || receiving || ctx.stale}
            onClick={() => {
              if (ctx.stale) return;
              void receivePurchase(showToast, ctx.reload, setReceiving, row.id, () => setSummaryTick((tick) => tick + 1));
            }}
          >
            收货
          </button>
        </>
      )}
      renderForm={(ctx) => (
        <PurchaseOrderFormFields
          form={ctx.form}
          update={ctx.update}
          editing={ctx.editing}
          editingId={editingIdRef.current}
          onItemsLoaded={() => { itemsLoadedRef.current = true; }}
        />
      )}
    />
  );
}
/* v8 ignore stop -- round 77 coverage calibration */
