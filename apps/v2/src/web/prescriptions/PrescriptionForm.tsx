import { DoctorSelect, SearchableSelect } from '../components';
import { PRESCRIPTION_STATUS_LABELS } from './constants';
import { ITEM_FIELDS, newItem } from './form';
import type { PrescriptionForm, PrescriptionItemForm } from './types';

export function PrescriptionForm({ form, update, editing }: { form: PrescriptionForm; update: (patch: Partial<PrescriptionForm>) => void; editing: boolean }) {
  function updateItem(id: string, patch: Partial<PrescriptionItemForm>) {
    update({ items: form.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <DoctorSelect label="医生" value={form.doctorId} onChange={(id) => update({ doctorId: id })} />
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
