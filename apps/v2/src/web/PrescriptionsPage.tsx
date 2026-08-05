import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
import { toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface PrescriptionRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  remark?: string | null;
}

interface PrescriptionItemForm {
  id: string;
  name: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: string;
  quantity: string;
  price: string;
}

function newItem(): PrescriptionItemForm {
  return { id: crypto.randomUUID(), name: '', spec: '', dosage: '', frequency: '', days: '1', quantity: '1', price: '' };
}

export function PrescriptionsPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<PrescriptionItemForm[]>([newItem()]);
  const [submitting, setSubmitting] = useState(false);

  const patients = useQuery({
    queryKey: ['prescription-patients'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=200'),
  });
  const doctors = useQuery({
    queryKey: ['prescription-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['prescriptions'],
    queryFn: () => apiRequest<Page<PrescriptionRow>>('/resources/prescriptions?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.name.trim() && item.days && item.quantity && item.price)
      .map((item) => ({
        name: item.name.trim(),
        spec: item.spec || undefined,
        dosage: item.dosage || undefined,
        frequency: item.frequency || undefined,
        days: Number(item.days),
        quantity: Number(item.quantity),
        price: toCents(item.price),
      }))
      .filter((item) => item.days > 0 && item.quantity > 0 && item.price >= 0);
    if (submitting || !patientId || !doctorId || validItems.length === 0) {
      showToast('请选择患者、医生并至少填写一条有效处方明细', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const prescription = await apiRequest<{ id: string }>('/resources/prescriptions', {
        method: 'POST',
        body: JSON.stringify({ patientId, doctorId, remark: remark || undefined }),
      });
      for (const item of validItems) {
        await apiRequest('/resources/prescriptionItems', {
          method: 'POST',
          body: JSON.stringify({ prescriptionId: prescription.id, ...item }),
        });
      }
      showToast('处方已创建', 'success');
      setShowForm(false);
      setPatientId('');
      setDoctorId('');
      setItems([newItem()]);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建处方失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    { key: 'remark', label: '备注' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>处方管理</h1>
        <button onClick={() => setShowForm(true)}>新建处方</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无处方" />
      )}

      <Dialog open={showForm} title="新建处方" onClose={() => setShowForm(false)}>
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
              <option value="">选择医生</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            备注
            <textarea value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          {items.map((item) => (
            <div className="prescription-item-row" key={item.id}>
              <input aria-label="药品名称" value={item.name} placeholder="药品名称" onChange={(event) => updateItem(item.id, { name: event.target.value })} />
              <input aria-label="规格" value={item.spec} placeholder="规格" onChange={(event) => updateItem(item.id, { spec: event.target.value })} />
              <input aria-label="剂量" value={item.dosage} placeholder="剂量" onChange={(event) => updateItem(item.id, { dosage: event.target.value })} />
              <input aria-label="频次" value={item.frequency} placeholder="频次" onChange={(event) => updateItem(item.id, { frequency: event.target.value })} />
              <input aria-label="天数" type="number" min="1" value={item.days} onChange={(event) => updateItem(item.id, { days: event.target.value })} />
              <input aria-label="数量" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} />
              <input aria-label="单价" type="number" min="0" value={item.price} onChange={(event) => updateItem(item.id, { price: event.target.value })} />
              <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>移除</button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((current) => [...current, newItem()])}>添加药品</button>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );

  function updateItem(id: string, patch: Partial<PrescriptionItemForm>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
}
