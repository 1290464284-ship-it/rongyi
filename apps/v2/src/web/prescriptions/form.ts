import { centsToYuanString, toCents } from '../lib/format';
import type { ItemPayload, PrescriptionForm, PrescriptionItemForm } from './types';

export function newItem(): PrescriptionItemForm {
  return { id: crypto.randomUUID(), name: '', spec: '', dosage: '', frequency: '', days: '1', quantity: '1', price: '' };
}

export function emptyForm(): PrescriptionForm {
  return { patientId: '', doctorId: '', remark: '', status: 'DRAFT', items: [newItem()] };
}

export const ITEM_FIELDS: Array<{ key: keyof PrescriptionItemForm; label: string; placeholder: string; type?: 'number'; min?: number }> = [
  { key: 'name', label: '药品名称', placeholder: '药品名称' },
  { key: 'spec', label: '规格', placeholder: '规格' },
  { key: 'dosage', label: '剂量', placeholder: '剂量' },
  { key: 'frequency', label: '频次', placeholder: '频次' },
  { key: 'days', label: '天数', placeholder: '', type: 'number', min: 1 },
  { key: 'quantity', label: '数量', placeholder: '', type: 'number', min: 1 },
  { key: 'price', label: '单价', placeholder: '', type: 'number', min: 0 },
];

export function validItems(form: PrescriptionForm) {
  return form.items
    .filter((item) => item.name.trim() && item.days && item.quantity && item.price)
    .map((item) => ({
      name: item.name.trim(),
      specification: item.spec || undefined,
      dosage: item.dosage || undefined,
      frequency: item.frequency || undefined,
      days: Number(item.days),
      quantity: Number(item.quantity),
      price: toCents(item.price),
    }))
    .filter((item) => item.days > 0 && item.quantity > 0 && item.price >= 0);
}

export function itemPayload(item: PrescriptionItemForm): ItemPayload {
  return {
    name: item.name.trim(),
    specification: item.spec || undefined,
    dosage: item.dosage || undefined,
    frequency: item.frequency || undefined,
    days: Number(item.days),
    quantity: Number(item.quantity),
    price: toCents(item.price),
  };
}

/** 服务端明细行 → 编辑表单明细（price 分 → 元字符串）。 */
export function itemRowToForm(row: Record<string, unknown>): PrescriptionItemForm {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    spec: String(row.specification ?? ''),
    dosage: String(row.dosage ?? ''),
    frequency: String(row.frequency ?? ''),
    days: String(row.days ?? ''),
    quantity: String(row.quantity ?? ''),
    price: centsToYuanString(row.price ?? 0),
  };
}
