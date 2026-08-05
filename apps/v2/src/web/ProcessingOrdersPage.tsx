import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
import { toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

interface ProcessingRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  status?: string | null;
}

interface ProcessingItemForm {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

function newItem(): ProcessingItemForm {
  return { id: crypto.randomUUID(), name: '', quantity: '1', unitPrice: '' };
}

export function ProcessingOrdersPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [number, setNumber] = useState('');
  const [shade, setShade] = useState('');
  const [teethNumbers, setTeethNumbers] = useState('');
  const [totalFee, setTotalFee] = useState('');
  const [items, setItems] = useState<ProcessingItemForm[]>([newItem()]);
  const [submitting, setSubmitting] = useState(false);

  const patients = useQuery({
    queryKey: ['processing-patients'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=200'),
  });
  const doctors = useQuery({
    queryKey: ['processing-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['processing-orders'],
    queryFn: () => apiRequest<Page<ProcessingRow>>('/resources/processingOrders?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.name.trim() && item.quantity && item.unitPrice)
      .map((item) => ({
        name: item.name.trim(),
        quantity: Number(item.quantity),
        unitPrice: toCents(item.unitPrice),
      }))
      .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
    if (submitting || !patientId || !number.trim() || validItems.length === 0) {
      showToast('请选择患者、填写加工单号并至少添加一条有效明细', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const calculatedTotalFee = validItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      await apiRequest('/processing-orders', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          doctorId: doctorId || undefined,
          number: number.trim(),
          shade: shade || undefined,
          teethNumbers: splitList(teethNumbers),
          totalFee: toCents(totalFee) || calculatedTotalFee,
          items: validItems,
          requestId: crypto.randomUUID(),
        }),
      });
      showToast('加工单已创建', 'success');
      setShowForm(false);
      setPatientId('');
      setNumber('');
      setItems([newItem()]);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建加工单失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, status: string) {
    try {
      await apiRequest(`/processing-orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('加工单状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  const columns = [
    { key: 'number', label: '加工单号' },
    { key: 'patientId', label: '患者' },
    {
      key: 'status',
      label: '状态',
      render: (row: ProcessingRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: ProcessingRow) => (
        <select
          defaultValue=""
          aria-label="变更加工状态"
          onChange={(event) => event.target.value && transition(row.id, event.target.value)}
        >
          <option value="">变更状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>加工单管理</h1>
        <button onClick={() => setShowForm(true)}>新建加工单</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无加工单" />
      )}

      <Dialog open={showForm} title="新建加工单" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <select value={patientId} onChange={(event) => setPatientId(event.target.value)}>
              <option value="">选择患者</option>
              {patients.data?.items.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            医生
            <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
              <option value="">不指定</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            加工单号
            <input value={number} onChange={(event) => setNumber(event.target.value)} />
          </label>
          <label>
            颜色
            <input value={shade} onChange={(event) => setShade(event.target.value)} />
          </label>
          <label>
            牙位（逗号分隔）
            <input value={teethNumbers} onChange={(event) => setTeethNumbers(event.target.value)} />
          </label>
          <label>
            总费用
            <input type="number" min="0" value={totalFee} onChange={(event) => setTotalFee(event.target.value)} />
          </label>
          {items.map((item) => (
            <div className="charge-item-row" key={item.id}>
              <input aria-label="加工项目" value={item.name} placeholder="项目名称" onChange={(event) => updateItem(item.id, { name: event.target.value })} />
              <input aria-label="加工数量" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} />
              <input aria-label="加工单价" type="number" min="0" value={item.unitPrice} onChange={(event) => updateItem(item.id, { unitPrice: event.target.value })} />
              <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>移除</button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((current) => [...current, newItem()])}>添加明细</button>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );

  function updateItem(id: string, patch: Partial<ProcessingItemForm>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
