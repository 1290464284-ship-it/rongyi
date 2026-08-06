import { toCents } from '../format';
import { METHOD_LABELS, type ChargeForm, type ChargeItemForm, type ValidChargeItem } from './charge-types';

export function newItem(): ChargeItemForm {
  return { id: crypto.randomUUID(), name: '', category: '', price: '', quantity: '1', costType: 'SERVICE' };
}

export function emptyChargeForm(): ChargeForm {
  return { patientId: '', items: [newItem()], remark: '', discount: '' };
}

export function buildValidItems(items: ChargeItemForm[]): ValidChargeItem[] {
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
export function methodCodeForName(name: string): string {
  const entry = Object.entries(METHOD_LABELS).find(([, label]) => label === name);
  return entry ? entry[0] : 'OTHER';
}
