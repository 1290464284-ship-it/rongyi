import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface PlanRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  name?: string | null;
  totalFee?: number | null;
  status?: string | null;
}

interface PlanItemForm {
  id: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  teethNumbers: string;
  status: string;
}

function newItem(): PlanItemForm {
  return { id: crypto.randomUUID(), code: '', name: '', category: '', price: '', quantity: '1', teethNumbers: '', status: 'PLANNED' };
}

export function TreatmentPlansPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('APPROVED');
  const [totalFee, setTotalFee] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<PlanItemForm[]>([newItem()]);
  const [submitting, setSubmitting] = useState(false);

  const doctors = useQuery({
    queryKey: ['plan-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['treatment-plans'],
    queryFn: () => apiRequest<Page<PlanRow>>('/resources/treatmentPlans?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.name.trim() && item.price && item.quantity)
      .map((item) => ({
        code: item.code || `ITEM-${Date.now()}`,
        name: item.name.trim(),
        category: item.category || 'GENERAL',
        price: toCents(item.price),
        quantity: Number(item.quantity),
        teethNumbers: splitList(item.teethNumbers),
        status: item.status,
      }))
      .filter((item) => item.price > 0 && item.quantity > 0);
    if (submitting || !patientId || !doctorId || !name.trim() || validItems.length === 0) {
      showToast('请选择患者、医生并填写计划名称和至少一条有效明细', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const calculatedFee = validItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const plan = await apiRequest<{ id: string }>('/resources/treatmentPlans', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          doctorId,
          name: name.trim(),
          status,
          totalFee: toCents(totalFee) || calculatedFee,
          remark: remark || undefined,
        }),
      });
      for (const item of validItems) {
        await apiRequest('/resources/treatmentPlanItems', {
          method: 'POST',
          body: JSON.stringify({ planId: plan.id, ...item }),
        });
      }
      showToast('治疗计划已创建', 'success');
      setShowForm(false);
      setPatientId('');
      setDoctorId('');
      setName('');
      setItems([newItem()]);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建治疗计划失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'name', label: '计划名称' },
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    { key: 'totalFee', label: '总费用', render: (row: PlanRow) => formatMoney(row.totalFee) },
    { key: 'status', label: '状态' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>治疗计划管理</h1>
        <button onClick={() => setShowForm(true)}>新建治疗计划</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无治疗计划" />
      )}

      <Dialog open={showForm} title="新建治疗计划" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <SearchableSelect resource="patients" value={patientId} onChange={setPatientId} ariaLabel="患者" placeholder="选择患者" />
          </label>
          <label>
            医生
            <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
              <option value="">选择医生</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            计划名称
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            状态
            <input value={status} onChange={(event) => setStatus(event.target.value)} />
          </label>
          <label>
            总费用
            <input type="number" min="0" value={totalFee} onChange={(event) => setTotalFee(event.target.value)} />
          </label>
          <label>
            备注
            <textarea value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          {items.map((item) => (
            <div className="charge-item-row" key={item.id}>
              <input aria-label="明细名称" value={item.name} placeholder="项目名称" onChange={(event) => updateItem(item.id, { name: event.target.value })} />
              <input aria-label="明细编码" value={item.code} placeholder="编码" onChange={(event) => updateItem(item.id, { code: event.target.value })} />
              <input aria-label="明细单价" type="number" min="0" value={item.price} onChange={(event) => updateItem(item.id, { price: event.target.value })} />
              <input aria-label="明细数量" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} />
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

  function updateItem(id: string, patch: Partial<PlanItemForm>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
