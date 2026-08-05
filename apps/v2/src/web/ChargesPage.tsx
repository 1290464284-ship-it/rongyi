import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
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
}

function newItem(): ChargeItemForm {
  return { id: crypto.randomUUID(), name: '', category: '', price: '', quantity: '1' };
}

export function ChargesPage() {
  const { showToast } = useToast();
  const [patientId, setPatientId] = useState('');
  const [items, setItems] = useState<ChargeItemForm[]>([newItem()]);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [refundTarget, setRefundTarget] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const query = useQuery({
    queryKey: ['charges'],
    queryFn: () => apiRequest<Page<ChargeRow>>('/resources/charges?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        category: item.category.trim() || 'GENERAL',
        price: toCents(item.price),
        quantity: Number(item.quantity || 0),
      }))
      .filter((item) => item.price > 0 && item.quantity > 0);
    if (submitting || !patientId || validItems.length === 0) {
      showToast('请选择患者并至少填写一条有效收费明细', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/charges', {
        method: 'POST',
        body: JSON.stringify({ patientId, items: validItems, remark: remark || undefined }),
      });
      showToast('收费单已创建', 'success');
      setPatientId('');
      setItems([newItem()]);
      setRemark('');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建收费失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function pay(event: FormEvent) {
    event.preventDefault();
    const amount = toCents(paymentAmount);
    if (submitting || !paymentTarget || amount <= 0) {
      showToast('请输入有效的收款金额', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/charges/${paymentTarget}/pay`, {
        method: 'PATCH',
        body: JSON.stringify({ amount, method: paymentMethod, requestId: crypto.randomUUID() }),
      });
      showToast('收款已记录', 'success');
      setPaymentTarget(null);
      setPaymentAmount('');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '收款失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function refund(event: FormEvent) {
    event.preventDefault();
    const amount = toCents(refundAmount);
    if (submitting || !refundTarget || amount <= 0) {
      showToast('请输入有效的退款金额', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/charges/${refundTarget}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amount, reason: refundReason || '桌面端退款', requestId: crypto.randomUUID() }),
      });
      showToast('退款已记录', 'success');
      setRefundTarget(null);
      setRefundAmount('');
      setRefundReason('');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '退款失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'number', label: '收费单号' },
    {
      key: 'totalAmount',
      label: '应收金额',
      render: (row: ChargeRow) => formatMoney(row.totalAmount),
    },
    {
      key: 'paidAmount',
      label: '实收金额',
      render: (row: ChargeRow) => formatMoney(row.paidAmount),
    },
    {
      key: 'status',
      label: '状态',
      render: (row: ChargeRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: ChargeRow) => (
        <>
          <button onClick={() => setPaymentTarget(row.id)}>收款</button>
          <button className="danger" onClick={() => setRefundTarget(row.id)}>退款</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>收费管理</h1>
      <form className="inline-form" onSubmit={create}>
        <SearchableSelect resource="patients" value={patientId} onChange={setPatientId} ariaLabel="患者" placeholder="选择患者" />
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '新建收费单'}</button>
      </form>
      <div className="charge-items">
        {items.map((item) => (
          <div className="charge-item-row" key={item.id}>
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
            <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>移除</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setItems((current) => [...current, newItem()])}>添加明细</button>
      <label>
        备注
        <textarea value={remark} onChange={(event) => setRemark(event.target.value)} />
      </label>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无收费单" />
      )}

      <Dialog open={paymentTarget !== null} title="收款" onClose={() => setPaymentTarget(null)}>
        <form onSubmit={pay}>
          <label>
            收款金额（元）
            <input type="number" min="0" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
          </label>
          <label>
            支付方式
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setPaymentTarget(null)}>取消</button>
            <button type="submit" disabled={submitting}>确认收款</button>
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
            <button type="submit" disabled={submitting}>确认退款</button>
          </div>
        </form>
      </Dialog>
    </div>
  );

  function updateItem(id: string, patch: Partial<ChargeItemForm>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
}
