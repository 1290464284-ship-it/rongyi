import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { ConfirmDialog, DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useCrudResource } from './use-crud-resource';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  UNPAID: '未付款',
  PARTIAL: '部分付款',
  PAID: '已付款',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '银行卡',
  DEBT: '欠费',
  MEMBER_CARD: '会员卡',
  UNIONPAY: '银联',
  INSURANCE: '医保',
  OTHER: '其他',
};

interface ChargeRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  status?: string | null;
}

interface ChargeItemForm {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  costType: 'SERVICE' | 'MATERIAL';
}

interface ChargeForm {
  patientId: string;
  items: ChargeItemForm[];
  remark: string;
  discount: string;
}

interface ChargeComboItemRow {
  id: string;
  comboId: string;
  catalogId?: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  costType?: 'SERVICE' | 'MATERIAL' | null;
}

interface ChargeComboRow {
  id: string;
  code: string;
  name: string;
  type: 'PUBLIC' | 'PRIVATE';
  items?: ChargeComboItemRow[];
}

interface ChargeTreeNode {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  costType: 'SERVICE' | 'MATERIAL' | null;
  anesthesia: boolean;
  businessCategory: 'SERVICE' | 'DRUG' | 'MATERIAL' | 'OTHER' | null;
  parentId: string | null;
  children: ChargeTreeNode[];
}

interface PayMethodNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  remark: string | null;
  children: PayMethodNode[];
}

function newItem(): ChargeItemForm {
  return { id: crypto.randomUUID(), name: '', category: '', price: '', quantity: '1', costType: 'SERVICE' };
}

function emptyChargeForm(): ChargeForm {
  return { patientId: '', items: [newItem()], remark: '', discount: '' };
}

interface ValidChargeItem {
  name: string;
  category: string;
  price: number;
  quantity: number;
  costType: 'SERVICE' | 'MATERIAL';
}

function buildValidItems(items: ChargeItemForm[]): ValidChargeItem[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      category: item.category.trim() || 'GENERAL',
      price: toCents(item.price),
      quantity: Number(item.quantity || 0),
      costType: item.costType,
    }))
    .filter((item) => item.price > 0 && item.quantity > 0);
}

/** 把自定义缴费方式的名称映射回后端 pay 端点认可的标准 method 码。 */
function methodCodeForName(name: string): string {
  const entry = Object.entries(METHOD_LABELS).find(([, label]) => label === name);
  return entry ? entry[0] : 'OTHER';
}

export function ChargesPage() {
  const { showToast } = useToast();
  const [paymentTarget, setPaymentTarget] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentMethodRoot, setPaymentMethodRoot] = useState('');
  const [refundTarget, setRefundTarget] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
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
    listPath: ({ page }) => `/resources/charges?page=${page}&pageSize=50`,
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

  const chargeTreeItems = chargeTreeQuery.data?.items ?? [];
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

  const columns: DataTableColumn<ChargeRow>[] = [
    { key: 'number', label: '收费单号' },
    { key: 'totalAmount', label: '应收金额', render: (row) => formatMoney(row.totalAmount) },
    { key: 'paidAmount', label: '实收金额', render: (row) => formatMoney(row.paidAmount) },
    { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button onClick={() => setPaymentTarget(row.id)}>收款</button>
          <button className="danger" onClick={() => setRefundTarget(row.id)}>退款</button>
          {String(row.status ?? '') === 'UNPAID' && (
            <button className="danger" onClick={() => setDeleteTarget(row)}>删除</button>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>收费管理</h1>
      <form className="inline-form" onSubmit={(event) => {
        // 已填写（有名称）但价格/数量无效的明细会被静默丢弃，提交前提示
        const filled = crud.form.items.filter((item) => item.name.trim()).length;
        const valid = buildValidItems(crud.form.items).length;
        if (filled - valid > 0) showToast(`${filled - valid} 条明细因缺少有效价格或数量将被忽略`, 'info');
        return crud.submit(event);
      }}>
        <SearchableSelect resource="patients" value={crud.form.patientId} onChange={(id) => crud.updateForm({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
        <button type="submit" disabled={crud.submitting}>{crud.submitting ? '保存中...' : '新建收费单'}</button>
      </form>
      <div className="charge-items">
        {crud.form.items.map((item) => (
          <div className="charge-item-row" style={{ gridTemplateColumns: '2fr 1fr 1fr 80px 72px 90px 72px' }} key={item.id}>
            <input
              aria-label="项目名称"
              value={item.name}
              placeholder="项目名称"
              onChange={(event) => updateItem(item.id, { name: event.target.value })}
            />
            <input
              aria-label="项目分类"
              value={item.category}
              placeholder="分类"
              onChange={(event) => updateItem(item.id, { category: event.target.value })}
            />
            <input
              aria-label="单价"
              type="number"
              min="0"
              value={item.price}
              placeholder="单价"
              onChange={(event) => updateItem(item.id, { price: event.target.value })}
            />
            <input
              aria-label="数量"
              type="number"
              min="1"
              value={item.quantity}
              onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
            />
            <select
              aria-label="类型"
              value={item.costType}
              onChange={(event) => updateItem(item.id, { costType: event.target.value as 'SERVICE' | 'MATERIAL' })}
            >
              <option value="SERVICE">服务</option>
              <option value="MATERIAL">材料</option>
            </select>
            <button type="button" onClick={() => crud.updateForm({ items: crud.form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
          </div>
        ))}
      </div>
      <div className="inline-form">
        <button type="button" onClick={() => crud.updateForm({ items: [...crud.form.items, newItem()] })}>添加明细</button>
        <button type="button" onClick={loadCombos} disabled={comboLoading}>{comboLoading ? '加载中...' : '调出收费组合'}</button>
      </div>
      <div className="inline-form">
        <label>
          优惠金额（元）
          <input type="number" min="0" value={crud.form.discount} onChange={(event) => crud.updateForm({ discount: event.target.value })} />
        </label>
        <button type="button" onClick={quoteMemberDiscount} disabled={actionBusy}>会员折扣试算</button>
      </div>
      <label>
        备注
        <textarea value={crud.form.remark} onChange={(event) => crud.updateForm({ remark: event.target.value })} />
      </label>
      {crud.rows.length ? (
        <DataTable columns={columns} rows={crud.rows} keyField="id" />
      ) : (
        <EmptyState message="暂无收费单" />
      )}

      <section aria-label="收费项目" className="charge-tree-panel">
        <h2>收费项目</h2>
        {chargeTreeQuery.isLoading ? (
          <LoadingState label="收费项目加载中..." />
        ) : chargeTreeQuery.error ? (
          <p className="error">{errorMessage(chargeTreeQuery.error, '收费项目加载失败')}</p>
        ) : chargeTreeItems.length === 0 ? (
          <EmptyState message="暂无收费项目" />
        ) : (
          <ul className="charge-tree">{chargeTreeItems.map((node) => renderCatalogNode(node, 0))}</ul>
        )}
      </section>

      <Dialog open={paymentTarget !== null} title="收款" onClose={() => setPaymentTarget(null)}>
        <form onSubmit={pay}>
          <label>
            收款金额（元）
            <input type="number" min="0" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
          </label>
          {payTreeLoaded ? (
            <>
              <label>
                支付方式大类
                <select aria-label="支付方式大类" value={effectivePayRoot} onChange={(event) => setPaymentMethodRoot(event.target.value)}>
                  {payRoots.map((node) => (
                    <option key={node.id} value={node.id}>{node.name}</option>
                  ))}
                </select>
              </label>
              <label>
                支付方式
                <select aria-label="支付方式" value={effectivePayLeaf} onChange={(event) => setPaymentMethod(event.target.value)}>
                  {payLeafOptions.map((node) => (
                    <option key={node.id} value={node.id}>{node.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              支付方式
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="modal-actions">
            <button type="button" onClick={() => setPaymentTarget(null)}>取消</button>
            <button type="submit" disabled={actionBusy}>确认收款</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={refundTarget !== null} title="退款" onClose={() => setRefundTarget(null)}>
        <form onSubmit={refund}>
          <label>
            退款金额（元）
            <input type="number" min="0" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} />
          </label>
          <label>
            退款原因
            <textarea value={refundReason} onChange={(event) => setRefundReason(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setRefundTarget(null)}>取消</button>
            <button type="submit" disabled={actionBusy}>确认退款</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={quickTarget !== null} title="快捷收费" onClose={() => setQuickTarget(null)}>
        <form onSubmit={quickCharge}>
          <label>
            项目名
            <input readOnly aria-label="快捷收费项目名" value={quickTarget?.name ?? ''} />
          </label>
          <label>
            单价（元）
            <input readOnly aria-label="快捷收费单价" value={quickTarget ? (quickTarget.price / 100).toString() : ''} />
          </label>
          <label>
            数量
            <input
              type="number"
              min="1"
              step="1"
              aria-label="快捷收费数量"
              value={quickQuantity}
              onChange={(event) => setQuickQuantity(event.target.value)}
            />
          </label>
          <span>患者</span>
          <SearchableSelect resource="patients" value={quickPatientId} onChange={setQuickPatientId} ariaLabel="快捷收费患者" placeholder="选择患者" />
          <div className="modal-actions">
            <button type="button" onClick={() => setQuickTarget(null)}>取消</button>
            <button type="submit" disabled={quickBusy}>{quickBusy ? '提交中...' : '确认快捷收费'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={comboOpen} title="调出收费组合" onClose={() => setComboOpen(false)}>
        {combos === null ? <LoadingState /> : combos.length === 0 ? (
          <EmptyState message="暂无可用收费组合" />
        ) : (
          <div className="combo-list">
            {combos.map((combo) => (
              <div className="charge-item-row" style={{ gridTemplateColumns: '2fr 1fr 72px 72px 72px' }} key={combo.id}>
                <span>{combo.name}</span>
                <span>{combo.code}</span>
                <span>{combo.items?.length ?? 0} 项</span>
                <span>{combo.type === 'PUBLIC' ? '公共' : '私有'}</span>
                <button type="button" aria-label={`载入组合 ${combo.name}`} onClick={() => applyCombo(combo)}>载入</button>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={() => setComboOpen(false)}>取消</button>
        </div>
      </Dialog>
    </div>
  );

  function updateItem(id: string, patch: Partial<ChargeItemForm>) {
    crud.updateForm({ items: crud.form.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }

  async function pay(event: FormEvent) {
    event.preventDefault();
    const amount = toCents(paymentAmount);
    if (actionBusy || !paymentTarget || amount <= 0) {
      showToast('请输入有效的收款金额', 'error');
      return;
    }
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
      setActionBusy(false);
    }
  }

  async function refund(event: FormEvent) {
    event.preventDefault();
    const amount = toCents(refundAmount);
    if (actionBusy || !refundTarget || amount <= 0) {
      showToast('请输入有效的退款金额', 'error');
      return;
    }
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
      setActionBusy(false);
    }
  }

  function toggleCatalog(id: string) {
    setExpandedCatalogs((current) => ({ ...current, [id]: !(current[id] ?? false) }));
  }

  async function deleteCharge() {
    if (actionBusy || !deleteTarget) return;
    setActionBusy(true);
    try {
      await apiRequest(`/charges/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('收费单已删除', 'success');
      setDeleteTarget(null);
      await crud.reload();
    } catch (error) {
      showToast(errorMessage(error, '删除收费单失败'), 'error');
      setDeleteTarget(null);
    } finally {
      setActionBusy(false);
    }
  }

  function openQuickCharge(node: ChargeTreeNode) {
    setQuickTarget(node);
    setQuickQuantity('1');
    setQuickPatientId('');
  }

  async function quickCharge(event: FormEvent) {
    event.preventDefault();
    if (quickBusy || !quickTarget) return;
    const quantity = Number(quickQuantity);
    if (!quickPatientId || !Number.isInteger(quantity) || quantity <= 0) {
      showToast('请选择患者并填写有效的数量', 'error');
      return;
    }
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

  function renderCatalogNode(node: ChargeTreeNode, depth: number) {
    if (node.children.length === 0) {
      return (
        <li className="catalog-leaf" key={node.id} style={{ paddingLeft: 8 + depth * 18 }}>
          <button type="button" aria-label={`快捷划价 ${node.name}`} onClick={() => openQuickCharge(node)}>
            {node.name} · {formatMoney(node.price)}
          </button>
          {node.costType === 'MATERIAL' && <span className="catalog-tag">材料</span>}
        </li>
      );
    }
    const expanded = expandedCatalogs[node.id] ?? false;
    return (
      <li className="catalog-branch" key={node.id}>
        <button
          type="button"
          aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
          onClick={() => toggleCatalog(node.id)}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {expanded ? '▾' : '▸'} {node.name} · {formatMoney(node.price)}
        </button>
        {expanded && <ul>{node.children.map((child) => renderCatalogNode(child, depth + 1))}</ul>}
      </li>
    );
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
    if (actionBusy || !crud.form.patientId || baseTotal <= 0) {
      showToast('请先选择患者并填写有效明细', 'error');
      return;
    }
    setActionBusy(true);
    try {
      const data = await apiRequest<{ applied?: boolean; code?: string; baseTotal?: number; total?: number; message?: string }>('/member-cards/quote', {
        method: 'POST',
        body: JSON.stringify({ patientId: crud.form.patientId, baseTotal }),
      });
      if (data.applied && typeof data.baseTotal === 'number' && typeof data.total === 'number') {
        crud.updateForm({ discount: ((data.baseTotal - data.total) / 100).toFixed(2) });
        showToast(`会员折扣已试算，折后价 ${formatMoney(data.total)}`, 'success');
      } else if (data.code === 'NO_ACTIVE_CARD') {
        showToast('该患者没有可用会员卡', 'info');
      } else if (data.code === 'NO_PLAN') {
        showToast('该患者没有可用会员方案', 'info');
      } else {
        showToast(data.message ?? '暂无可用会员折扣', 'info');
      }
    } catch (error) {
      showToast(errorMessage(error, '会员折扣试算失败'), 'error');
    } finally {
      setActionBusy(false);
    }
  }
}
