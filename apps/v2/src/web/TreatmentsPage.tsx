import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  PLANNED: '已计划',
  APPROVED: '已确认',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

interface TreatmentRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  name?: string | null;
  price?: number | null;
  status?: string | null;
}

interface TreatmentForm {
  patientId: string;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  teethNumbers: string;
  status: string;
  plannedDate: string;
  completedDate: string;
  remark: string;
}

const emptyForm: TreatmentForm = {
  patientId: '',
  doctorId: '',
  code: '',
  name: '',
  category: '',
  price: '',
  quantity: '1',
  teethNumbers: '',
  status: 'PLANNED',
  plannedDate: '',
  completedDate: '',
  remark: '',
};

export function TreatmentsPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TreatmentForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const doctors = useQuery({
    queryKey: ['treatment-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const query = useQuery({
    queryKey: ['treatments'],
    queryFn: () => apiRequest<Page<TreatmentRow>>('/resources/treatments?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const price = Number(form.price || 0);
    const quantity = Number(form.quantity || 0);
    if (submitting || !form.patientId || !form.doctorId || !form.name.trim() || price <= 0 || quantity <= 0) {
      showToast('请选择患者、医生并填写治疗名称、价格和数量', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/resources/treatments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          doctorId: form.doctorId,
          code: form.code || `T-${Date.now()}`,
          name: form.name.trim(),
          category: form.category || 'GENERAL',
          price: toCents(price),
          quantity,
          teethNumbers: splitList(form.teethNumbers),
          status: form.status,
          plannedDate: form.plannedDate || undefined,
          completedDate: form.completedDate || undefined,
          remark: form.remark || undefined,
        }),
      });
      showToast('治疗记录已创建', 'success');
      setShowForm(false);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建治疗记录失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, status: string) {
    try {
      await apiRequest(`/treatments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('治疗状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  const columns = [
    { key: 'name', label: '治疗项目' },
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
    { key: 'price', label: '价格', render: (row: TreatmentRow) => formatMoney(row.price) },
    {
      key: 'status',
      label: '状态',
      render: (row: TreatmentRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: TreatmentRow) => (
        <select
          defaultValue=""
          aria-label="变更治疗状态"
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
        <h1>治疗管理</h1>
        <button onClick={() => setShowForm(true)}>新建治疗</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无治疗" />
      )}

      <Dialog open={showForm} title="新建治疗" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => setForm((current) => ({ ...current, patientId: id }))} ariaLabel="患者" placeholder="选择患者" />
          </label>
          <label>
            医生
            <select value={form.doctorId} onChange={(event) => setForm((current) => ({ ...current, doctorId: event.target.value }))}>
              <option value="">选择医生</option>
              {doctors.data?.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            项目编码
            <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
          </label>
          <label>
            治疗名称
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            分类
            <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
          </label>
          <label>
            价格
            <input type="number" min="0" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} />
          </label>
          <label>
            数量
            <input type="number" min="1" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} />
          </label>
          <label>
            牙位（逗号分隔）
            <input value={form.teethNumbers} onChange={(event) => setForm((current) => ({ ...current, teethNumbers: event.target.value }))} />
          </label>
          <label>
            状态
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            计划日期
            <input type="date" value={form.plannedDate} onChange={(event) => setForm((current) => ({ ...current, plannedDate: event.target.value }))} />
          </label>
          <label>
            完成日期
            <input type="date" value={form.completedDate} onChange={(event) => setForm((current) => ({ ...current, completedDate: event.target.value }))} />
          </label>
          <label>
            备注
            <textarea value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
