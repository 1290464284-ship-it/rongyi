import { todayLocalDate } from '../format';

export interface DispenseRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  pharmacistName?: string | null;
  status?: string | null;
  itemsCount?: number;
  dispensedAt?: string | null;
  returnedAt?: string | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface DispenseDetailItem {
  id: string;
  itemId?: string;
  batchId?: string | null;
  name?: string | null;
  spec?: string | null;
  quantity?: number;
  returnedQuantity?: number;
  batchManaged?: number;
  stock?: number;
}

export interface DispenseDetail extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  note?: string | null;
  status?: string | null;
  items: DispenseDetailItem[];
}

export interface CreateItemRow {
  key: string;
  /** 已存在明细行的服务端 id（编辑回填时携带，提交时回传用于更新）。 */
  id?: string;
  itemId: string;
  quantity: string;
  batchId: string;
}

export interface CreateForm {
  number: string;
  patientId: string;
  note: string;
  items: CreateItemRow[];
}

export interface NarcoticForm {
  recordDate: string;
  itemId: string;
  batchNo: string;
  quantity: string;
  usage: string;
  balanceBefore: string;
  balanceAfter: string;
  remark: string;
}

export function newCreateItem(): CreateItemRow {
  return { key: crypto.randomUUID(), itemId: '', quantity: '1', batchId: '' };
}

export function emptyCreateForm(): CreateForm {
  return { number: '', patientId: '', note: '', items: [newCreateItem()] };
}

export function emptyNarcoticForm(): NarcoticForm {
  return {
    recordDate: todayLocalDate(),
    itemId: '',
    batchNo: '',
    quantity: '',
    usage: '',
    balanceBefore: '',
    balanceAfter: '',
    remark: '',
  };
}
