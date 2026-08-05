import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';
import { toCents } from './format';

interface PrescriptionRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
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

interface PrescriptionForm {
  patientId: string;
  doctorId: string;
  remark: string;
  items: PrescriptionItemForm[];
}

function newItem(): PrescriptionItemForm {
  return { id: crypto.randomUUID(), name: '', spec: '', dosage: '', frequency: '', days: '1', quantity: '1', price: '' };
}

function emptyForm(): PrescriptionForm {
  return { patientId: '', doctorId: '', remark: '', items: [newItem()] };
}

const ITEM_FIELDS: Array<{ key: keyof PrescriptionItemForm; label: string; placeholder: string; type?: 'number'; min?: number }> = [
  { key: 'name', label: '药品名称', placeholder: '药品名称' },
  { key: 'spec', label: '规格', placeholder: '规格' },
  { key: 'dosage', label: '剂量', placeholder: '剂量' },
  { key: 'frequency', label: '频次', placeholder: '频次' },
  { key: 'days', label: '天数', placeholder: '', type: 'number', min: 1 },
  { key: 'quantity', label: '数量', placeholder: '', type: 'number', min: 1 },
  { key: 'price', label: '单价', placeholder: '', type: 'number', min: 0 },
];

function validItems(form: PrescriptionForm) {
  return form.items
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
}

const prescriptionColumns: DataTableColumn<PrescriptionRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'remark', label: '备注' },
];

export function PrescriptionsPage() {
  return (
    <CrudPage<PrescriptionRow, PrescriptionForm>
      title="处方管理"
      createLabel="新建处方"
      emptyMessage="暂无处方"
      queryKey={['prescriptions']}
      endpoint="/resources/prescriptions"
      initialForm={emptyForm}
      validate={(form) =>
        !form.patientId || !form.doctorId || validItems(form).length === 0
          ? '请选择患者、医生并至少填写一条有效处方明细'
          : null
      }
      submitOverride={({ form }) => createPrescription(form)}
      messages={{ create: '处方已创建' }}
      errorMessages={{ create: '创建处方失败' }}
      columns={prescriptionColumns}
      renderForm={(ctx) => <PrescriptionForm form={ctx.form} update={ctx.update} />}
    />
  );
}

async function createPrescription(form: PrescriptionForm): Promise<void> {
  const items = validItems(form);
  let prescriptionId: string | null = null;
  const createdItemIds: string[] = [];
  try {
    const prescription = await apiRequest<{ id: string }>('/resources/prescriptions', {
      method: 'POST',
      body: JSON.stringify({ patientId: form.patientId, doctorId: form.doctorId, remark: form.remark || undefined }),
    });
    prescriptionId = prescription.id;
    for (const item of items) {
      const created = await apiRequest<{ id: string }>('/resources/prescriptionItems', {
        method: 'POST',
        body: JSON.stringify({ prescriptionId: prescription.id, ...item }),
      });
      createdItemIds.push(created.id);
    }
  } catch (error) {
    // 主记录已创建但明细中途失败：清理孤儿记录（清理失败仅告警，不掩盖原始错误）
    if (prescriptionId) {
      try {
        await cleanupOrphanPrescription(prescriptionId, createdItemIds);
      } catch (cleanupError) {
        console.warn('清理孤儿处方失败', cleanupError);
      }
    }
    throw error;
  }
}

function PrescriptionForm({ form, update }: { form: PrescriptionForm; update: (patch: Partial<PrescriptionForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['prescription-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  function updateItem(id: string, patch: Partial<PrescriptionItemForm>) {
    update({ items: form.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
      {form.items.map((item) => (
        <div className="prescription-item-row" key={item.id}>
          {ITEM_FIELDS.map((field) => (
            <input
              key={field.key}
              aria-label={field.label}
              placeholder={field.placeholder}
              type={field.type ?? 'text'}
              min={field.min}
              value={item[field.key]}
              onChange={(event) => updateItem(item.id, { [field.key]: event.target.value } as Partial<PrescriptionItemForm>)}
            />
          ))}
          <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" onClick={() => update({ items: [...form.items, newItem()] })}>添加药品</button>
    </>
  );
}

async function cleanupOrphanPrescription(prescriptionId: string, createdItemIds: string[]): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/prescriptionItems/${itemId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`删除处方明细失败（继续清理主记录）：${itemId}`, error);
    }
  }
  try {
    await apiRequest(`/resources/prescriptions/${prescriptionId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(`删除孤儿处方失败：${prescriptionId}`, error);
  }
}
