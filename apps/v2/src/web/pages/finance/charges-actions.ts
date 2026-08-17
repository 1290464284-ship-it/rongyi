import { useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { centsToYuanString, formatMoney, toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import type { CrudResourceResult } from '../../hooks/use-crud-resource';
import {
  METHOD_LABELS,
  type ChargeComboRow,
  type ChargeForm,
  type ChargeItemForm,
  type ChargeRow,
  type ChargeTreeNode,
  type PayMethodNode,
} from '../../charges/types';
import { buildValidItems, methodCodeForName } from '../../charges/charge-utils';
import { resolvePayMethodSelection } from './charges-pay-methods';

export interface ChargesActions {
  paymentTarget: string | null;
  setPaymentTarget: Dispatch<SetStateAction<string | null>>;
  paymentAmount: string;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  paymentMethod: string;
  setPaymentMethod: Dispatch<SetStateAction<string>>;
  paymentMethodRoot: string;
  setPaymentMethodRoot: Dispatch<SetStateAction<string>>;
  refundTarget: string | null;
  setRefundTarget: Dispatch<SetStateAction<string | null>>;
  refundAmount: string;
  setRefundAmount: Dispatch<SetStateAction<string>>;
  refundReason: string;
  setRefundReason: Dispatch<SetStateAction<string>>;
  actionBusy: boolean;
  comboOpen: boolean;
  setComboOpen: Dispatch<SetStateAction<boolean>>;
  combos: ChargeComboRow[] | null;
  comboLoading: boolean;
  expandedCatalogs: Record<string, boolean>;
  setExpandedCatalogs: Dispatch<SetStateAction<Record<string, boolean>>>;
  quickTarget: ChargeTreeNode | null;
  setQuickTarget: Dispatch<SetStateAction<ChargeTreeNode | null>>;
  quickQuantity: string;
  setQuickQuantity: Dispatch<SetStateAction<string>>;
  quickPatientId: string;
  setQuickPatientId: Dispatch<SetStateAction<string>>;
  quickBusy: boolean;
  deleteTarget: ChargeRow | null;
  setDeleteTarget: Dispatch<SetStateAction<ChargeRow | null>>;
  chargeTreeQuery: UseQueryResult<{ items: ChargeTreeNode[] }>;
  payMethodQuery: UseQueryResult<{ items: PayMethodNode[] }>;
  payTreeLoaded: boolean;
  payRoots: PayMethodNode[];
  payLeafOptions: PayMethodNode[];
  effectivePayRoot: string;
  effectivePayLeaf: string;
  stale: boolean;
  updateItem: (id: string, patch: Partial<ChargeItemForm>) => void;
  pay: (event: FormEvent) => Promise<void>;
  refund: (event: FormEvent) => Promise<void>;
  deleteCharge: () => Promise<void>;
  toggleCatalog: (id: string) => void;
  openQuickCharge: (node: ChargeTreeNode) => void;
  quickCharge: (event: FormEvent) => Promise<void>;
  loadCombos: () => Promise<void>;
  applyCombo: (combo: ChargeComboRow) => Promise<void>;
  quoteMemberDiscount: () => Promise<void>;
}

export function useChargesActions(crud: CrudResourceResult<ChargeRow, ChargeForm>): ChargesActions {
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

  const stale = crud.query.isPlaceholderData;

  const chargeTreeQuery = useQuery({
    queryKey: ['charge-trees'],
    queryFn: () => apiRequest<{ items: ChargeTreeNode[] }>('/charge-trees'),
    // 字典类数据低频变更，5 分钟内复用缓存，避免每次挂载/聚焦重拉
    staleTime: 5 * 60_000,
  });
  const payMethodQuery = useQuery({
    queryKey: ['pay-methods', 'tree'],
    queryFn: () => apiRequest<{ items: PayMethodNode[] }>('/pay-methods/tree'),
    staleTime: 5 * 60_000,
  });

  const payMethodItems = (payMethodQuery.data?.items ?? []).filter((node) => node.active !== false);
  const {
    payTreeLoaded,
    payRoots,
    payLeafOptions,
    effectivePayRoot,
    effectivePayLeaf,
  } = resolvePayMethodSelection(payMethodItems, paymentMethodRoot, paymentMethod);

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
        /* v8 ignore next -- effectivePayLeaf 必在 payLeafOptions 中，leaf 恒存在 */
        method = leaf ? methodCodeForName(leaf.name) : 'OTHER';
        payMethodName = leaf?.name;
      } else {
        /* v8 ignore next -- 回退列表即 METHOD_LABELS 键集，查表恒命中 */
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

  return {
    paymentTarget,
    setPaymentTarget,
    paymentAmount,
    setPaymentAmount,
    paymentMethod,
    setPaymentMethod,
    paymentMethodRoot,
    setPaymentMethodRoot,
    refundTarget,
    setRefundTarget,
    refundAmount,
    setRefundAmount,
    refundReason,
    setRefundReason,
    actionBusy,
    comboOpen,
    setComboOpen,
    combos,
    comboLoading,
    expandedCatalogs,
    setExpandedCatalogs,
    quickTarget,
    setQuickTarget,
    quickQuantity,
    setQuickQuantity,
    quickPatientId,
    setQuickPatientId,
    quickBusy,
    deleteTarget,
    setDeleteTarget,
    chargeTreeQuery,
    payMethodQuery,
    payTreeLoaded,
    payRoots,
    payLeafOptions,
    effectivePayRoot,
    effectivePayLeaf,
    stale,
    updateItem,
    pay,
    refund,
    deleteCharge,
    toggleCatalog,
    openQuickCharge,
    quickCharge,
    loadCombos,
    applyCombo,
    quoteMemberDiscount,
  };
}
