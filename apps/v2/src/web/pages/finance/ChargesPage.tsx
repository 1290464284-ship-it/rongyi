import { FormEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { Dialog, ConfirmDialog, LoadingState, PageError, SearchInput } from '../../components';
import { formatMoney, centsToYuanString, toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useCrudResource } from '../../hooks/use-crud-resource';
import { useToast } from '../../lib/toast-context';
import { ChargeCreateForm } from '../../charges/ChargeCreateForm';
import { ChargeList } from '../../charges/ChargeList';
import { ChargeTreePanel } from '../../charges/ChargeTreePanel';
import { PaymentDialog } from '../../charges/PaymentDialog';
import { RefundDialog } from '../../charges/RefundDialog';
import { QuickChargeDialog } from '../../charges/QuickChargeDialog';
import { ComboDialog } from '../../charges/ComboDialog';
import {
  METHOD_LABELS,
  type ChargeComboRow,
  type ChargeForm,
  type ChargeItemForm,
  type ChargeRow,
  type ChargeTreeNode,
  type PayMethodNode,
} from '../../charges/types';
import { buildValidItems, emptyChargeForm, methodCodeForName } from '../../charges/charge-utils';

export function ChargesPage({ initialSearch }: { initialSearch?: string } = {}) {
  const { showToast } = useToast();
  const [paymentTarget, setPaymentTarget] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentMethodRoot, setPaymentMethodRoot] = useState('');
  const [refundTarget, setRefundTarget] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [combos, setCombos] = useState<ChargeComboRow[] | null>(null);
  const [comboLoading, setComboLoading] = useState(false);
  const [expandedCatalogs, setExpandedCatalogs] = useState<Record<string, boolean>>({});
  const [quickTarget, setQuickTarget] = useState<ChargeTreeNode | null>(null);
  const [quickQuantity, setQuickQuantity] = useState('1');
  const [quickPatientId, setQuickPatientId] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChargeRow | null>(null);

  const crud = useCrudResource<ChargeRow, ChargeForm>({
    queryKey: ['charges'],
    endpoint: '/charges',
    listPath: ({ page, search }) => `/resources/charges?page=${page}&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    initialSearch,
    initialForm: emptyChargeForm,
    validate: (form) => {
      const validItems = buildValidItems(form.items);
      if (!form.patientId || validItems.length === 0) {
        return '请选择患者并至少填写一条有效收费明细';
      }
      return null;
    },
    toPayload: (form) => ({
      patientId: form.patientId,
      items: buildValidItems(form.items),
      discount: toCents(form.discount) || undefined,
      remark: form.remark || undefined,
    }),
    messages: { create: '收费单已创建' },
    errorMessages: { create: '创建收费失败' },
  });
  const stale = crud.query.isPlaceholderData;

  const chargeTreeQuery = useQuery({
    queryKey: ['charge-trees'],
    queryFn: () => apiRequest<{ items: ChargeTreeNode[] }>('/charge-trees'),
  });
  const payMethodQuery = useQuery({
    queryKey: ['pay-methods', 'tree'],
    queryFn: () => apiRequest<{ items: PayMethodNode[] }>('/pay-methods/tree'),
  });

  if (crud.query.isLoading) return <LoadingState />;
  if (crud.query.error) return <PageError message={(crud.query.error as Error).message} />;

  const payMethodItems = (payMethodQuery.data?.items ?? []).filter((node) => node.active !== false);
  const payTreeLoaded = payMethodItems.length > 0;
  // 未配置缴费方式树时退回内置方式列表（两级下拉的第二级仍以“支付方式”呈现）。
  const fallbackPayMethods: PayMethodNode[] = Object.entries(METHOD_LABELS).map(([code, label]) => ({
    id: code,
    name: label,
    parentId: null,
    sortOrder: 0,
    active: true,
    remark: null,
    children: [],
  }));
  const payRoots = payTreeLoaded ? payMethodItems : fallbackPayMethods;
  const effectivePayRoot = payRoots.some((node) => node.id === paymentMethodRoot)
    ? paymentMethodRoot
    : (payRoots[0]?.id ?? '');
  const payRootNode = payRoots.find((node) => node.id === effectivePayRoot);
  const payLeafOptions = payTreeLoaded
    ? payRootNode
      ? (payRootNode.children.length > 0 ? payRootNode.children : [payRootNode])
      : []
    : fallbackPayMethods;
  const effectivePayLeaf = payLeafOptions.some((node) => node.id === paymentMethod)
    ? paymentMethod
    : (payLeafOptions[0]?.id ?? '');

  return (
    <div className="page">
      <div className="page-head">
        <h1>收费管理</h1>
        <SearchInput
          value={crud.searchInput}
          onChange={crud.setSearch}
          placeholder="搜索收费单..."
          ariaLabel="搜索收费单"
        />
      </div>
      <ChargeCreateForm
        form={crud.form}
        update={crud.updateForm}
        updateItem={updateItem}
        submitting={crud.submitting}
        onSubmit={crud.submit}
        comboLoading={comboLoading}
        actionBusy={actionBusy}
        onLoadCombos={loadCombos}
        onQuoteDiscount={quoteMemberDiscount}
      />
      <ChargeList
        rows={crud.rows}
        onPayment={setPaymentTarget}
        onRefund={setRefundTarget}
        onDelete={setDeleteTarget}
        disabled={stale}
      />

      <section aria-label="收费项目" className="charge-tree-panel">
        <h2>收费项目</h2>
        <ChargeTreePanel
          isLoading={chargeTreeQuery.isLoading}
          error={chargeTreeQuery.error}
          items={chargeTreeQuery.data?.items ?? []}
          expandedCatalogs={expandedCatalogs}
          onToggleCatalog={toggleCatalog}
          onQuickCharge={openQuickCharge}
        />
      </section>

      <Dialog open={paymentTarget !== null} title="收款" onClose={() => setPaymentTarget(null)}>
        <PaymentDialog
          amount={paymentAmount}
          setAmount={setPaymentAmount}
          method={paymentMethod}
          setMethod={setPaymentMethod}
          methodRoot={paymentMethodRoot}
          setMethodRoot={setPaymentMethodRoot}
          busy={actionBusy}
          onClose={() => setPaymentTarget(null)}
          onSubmit={pay}
          payTreeLoaded={payTreeLoaded}
          payRoots={payRoots}
          payLeafOptions={payLeafOptions}
          effectivePayRoot={effectivePayRoot}
          effectivePayLeaf={effectivePayLeaf}
        />
      </Dialog>

      <Dialog open={refundTarget !== null} title="退款" onClose={() => setRefundTarget(null)}>
        <RefundDialog
          amount={refundAmount}
          setAmount={setRefundAmount}
          reason={refundReason}
          setReason={setRefundReason}
          busy={actionBusy}
          onClose={() => setRefundTarget(null)}
          onSubmit={refund}
        />
      </Dialog>

      <Dialog open={quickTarget !== null} title="快捷收费" onClose={() => setQuickTarget(null)}>
        <QuickChargeDialog
          target={quickTarget}
          quantity={quickQuantity}
          setQuantity={setQuickQuantity}
          patientId={quickPatientId}
          setPatientId={setQuickPatientId}
          busy={quickBusy}
          onClose={() => setQuickTarget(null)}
          onSubmit={quickCharge}
        />
      </Dialog>

      <Dialog open={comboOpen} title="调出收费组合" onClose={() => setComboOpen(false)}>
        <ComboDialog combos={combos} onClose={() => setComboOpen(false)} onApply={applyCombo} />
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除收费单确认"
        message={`确定删除该收费单吗？此操作不可恢复。${deleteTarget ? `（${deleteTarget.number ?? deleteTarget.id}）` : ''}`}
        confirmText="确认删除"
        danger
        onConfirm={() => deleteCharge()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );

  function updateItem(id: string, patch: Partial<ChargeItemForm>) {
    crud.updateForm({ items: crud.form.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }

  async function pay(event: FormEvent) {
    if (stale) return;
    event.preventDefault();
    const amount = toCents(paymentAmount);
    if (actionBusy || actionBusyRef.current || !paymentTarget || amount <= 0) {
      showToast('请输入有效的收款金额', 'error');
      return;
    }
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      let method = effectivePayLeaf;
      let payMethodName: string | undefined;
      if (payTreeLoaded) {
        const leaf = payLeafOptions.find((node) => node.id === effectivePayLeaf);
        method = leaf ? methodCodeForName(leaf.name) : 'OTHER';
        payMethodName = leaf?.name;
      } else {
        payMethodName = METHOD_LABELS[effectivePayLeaf] ?? effectivePayLeaf;
      }
      await apiRequest(`/charges/${paymentTarget}/pay`, {
        method: 'PATCH',
        body: JSON.stringify({ amount, method, payMethodName, requestId: crypto.randomUUID() }),
      });
      showToast('收款已记录', 'success');
      setPaymentTarget(null);
      setPaymentAmount('');
      await crud.reload();
    } catch (error) {
      showToast(errorMessage(error, '收款失败'), 'error');
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  async function refund(event: FormEvent) {
    if (stale) return;
    event.preventDefault();
    const amount = toCents(refundAmount);
    if (actionBusy || actionBusyRef.current || !refundTarget || amount <= 0) {
      showToast('请输入有效的退款金额', 'error');
      return;
    }
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      await apiRequest(`/charges/${refundTarget}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amount, reason: refundReason || '桌面端退款', requestId: crypto.randomUUID() }),
      });
      showToast('退款已记录', 'success');
      setRefundTarget(null);
      setRefundAmount('');
      setRefundReason('');
      await crud.reload();
    } catch (error) {
      showToast(errorMessage(error, '退款失败'), 'error');
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  async function deleteCharge() {
    if (stale) return;
    if (actionBusy || actionBusyRef.current || !deleteTarget) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      await apiRequest(`/charges/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('收费单已删除', 'success');
      setDeleteTarget(null);
      const refreshed = await crud.query.refetch();
      // 删除末页最后一条时回退一页，避免停留在空页
      if (crud.page > 1 && (refreshed.data?.items?.length ?? 0) === 0) {
        crud.setPage(crud.page - 1);
      }
    } catch (error) {
      showToast(errorMessage(error, '删除收费单失败'), 'error');
      setDeleteTarget(null);
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  function toggleCatalog(id: string) {
    setExpandedCatalogs((current) => ({ ...current, [id]: !(current[id] ?? false) }));
  }

  function openQuickCharge(node: ChargeTreeNode) {
    setQuickTarget(node);
    setQuickQuantity('1');
    setQuickPatientId('');
  }

  async function quickCharge(event: FormEvent) {
    event.preventDefault();
    if (quickBusy || !quickTarget) return;
    // 数量必须是十进制正整数（拒绝 '1e3'、'0x10' 等非常规写法）
    if (!quickPatientId || !/^\d+$/.test(quickQuantity) || Number(quickQuantity) <= 0) {
      showToast('请选择患者并填写有效的数量', 'error');
      return;
    }
    const quantity = Number(quickQuantity);
    setQuickBusy(true);
    try {
      const result = await apiRequest<{ chargeId: string; number: string; totalAmount: number }>(
        `/charge-trees/${quickTarget.id}/quick-charge`,
        { method: 'POST', body: JSON.stringify({ patientId: quickPatientId, quantity }) },
      );
      showToast(`快捷划价成功，收费单 ${result.number}，应收 ${formatMoney(result.totalAmount)}`, 'success');
      setQuickTarget(null);
      setQuickQuantity('1');
      setQuickPatientId('');
      await crud.reload();
    } catch (error) {
      showToast(errorMessage(error, '快捷划价失败'), 'error');
    } finally {
      setQuickBusy(false);
    }
  }

  async function loadCombos() {
    if (combos === null) {
      setComboLoading(true);
      try {
        const data = await apiRequest<ChargeComboRow[]>('/charge-combos');
        setCombos(data);
      } catch (error) {
        showToast(errorMessage(error, '加载收费组合失败'), 'error');
        return;
      } finally {
        setComboLoading(false);
      }
    }
    setComboOpen(true);
  }

  async function applyCombo(combo: ChargeComboRow) {
    let items = combo.items ?? [];
    if (items.length === 0) {
      try {
        const detail = await apiRequest<ChargeComboRow>(`/charge-combos/${combo.id}/items`);
        items = detail.items ?? [];
      } catch (error) {
        showToast(errorMessage(error, '加载组合明细失败'), 'error');
        return;
      }
    }
    crud.updateForm({
      items: items.map((item) => ({
        id: crypto.randomUUID(),
        name: item.name,
        category: item.category,
        price: (item.price / 100).toString(),
        quantity: String(item.quantity),
        costType: item.costType ?? 'SERVICE',
      })),
    });
    setComboOpen(false);
    showToast(`收费组合「${combo.name}」已载入`, 'success');
  }

  async function quoteMemberDiscount() {
    const validItems = buildValidItems(crud.form.items);
    const baseTotal = validItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (actionBusy || actionBusyRef.current || !crud.form.patientId || baseTotal <= 0) {
      showToast('请先选择患者并填写有效明细', 'error');
      return;
    }
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      const data = await apiRequest<{ applied?: boolean; reason?: string; baseTotal?: number; total?: number; message?: string }>('/member-cards/quote', {
        method: 'POST',
        body: JSON.stringify({ patientId: crud.form.patientId, baseTotal }),
      });
      if (data.applied && typeof data.baseTotal === 'number' && typeof data.total === 'number') {
        crud.updateForm({ discount: centsToYuanString(data.baseTotal - data.total) });
        showToast(`会员折扣已试算，折后价 ${formatMoney(data.total)}`, 'success');
      } else if (data.reason === 'NO_ACTIVE_CARD') {
        showToast('该患者没有可用会员卡', 'info');
      } else if (data.reason === 'NO_PLAN') {
        showToast('该患者没有可用会员方案', 'info');
      } else {
        showToast(data.message ?? '暂无可用会员折扣', 'info');
      }
    } catch (error) {
      showToast(errorMessage(error, '会员折扣试算失败'), 'error');
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }
}
