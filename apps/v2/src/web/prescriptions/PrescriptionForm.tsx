import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { MissingSelectOption, SearchableSelect } from '../components';
import { PRESCRIPTION_STATUS_LABELS } from './constants';
import { ITEM_FIELDS, newItem } from './form';
import type { PrescriptionForm, PrescriptionItemForm } from './types';

export function PrescriptionForm({ form, update, editing }: { form: PrescriptionForm; update: (patch: Partial<PrescriptionForm>) => void; editing: boolean }) {
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
      {/* L4：/doctors 加载失败时行内提示并支持重试，避免静默空列表 */}
      {doctors.isError && (
        <div className="query-section-error">
          <p className="error">医生列表加载失败</p>
          <button type="button" onClick={() => void doctors.refetch()}>重试</button>
        </div>
      )}
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })} disabled={doctors.isError}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
          {form.doctorId !== '' && !(doctors.data ?? []).some((row) => String(row.id) === form.doctorId) && (
            <MissingSelectOption value={form.doctorId} />
          )}
        </select>
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
      {editing && (
        <label>
          状态
          <select value={form.status} disabled>
            {Object.entries(PRESCRIPTION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      )}
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
