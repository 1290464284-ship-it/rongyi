import * as crypto from 'node:crypto';

export interface ChargeItemSeedData {
  id: string;
  chargeId: string;
  treatmentId: string | null;
  inventoryItemId: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string;
  subtotal: number;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChargeSeedData {
  id: string;
  patientId: string;
  visitId: string | null;
  doctorId: string | null;
  number: string;
  totalAmount: number;
  paidAmount: number;
  refundedAmount: number;
  discount: number;
  status: string;
  payMethod: string | null;
  paidAt: string | null;
  remark: string;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
  items: ChargeItemSeedData[];
}

const TREATMENT_ITEMS = [
  { name: '超声波洁牙', category: '预防保健', price: 12000 },
  { name: '树脂补牙(前牙)', category: '修复治疗', price: 20000 },
  { name: '树脂补牙(后牙)', category: '修复治疗', price: 25000 },
  { name: '根管治疗(前牙)', category: '牙髓治疗', price: 50000 },
  { name: '根管治疗(后牙)', category: '牙髓治疗', price: 80000 },
  { name: '牙齿美白', category: '美容修复', price: 150000 },
  { name: '普通拔牙', category: '口腔外科', price: 15000 },
  { name: '智齿拔除', category: '口腔外科', price: 40000 },
  { name: '种植牙(韩系)', category: '修复治疗', price: 500000 },
  { name: '种植牙(欧美系)', category: '修复治疗', price: 800000 },
  { name: '烤瓷冠', category: '修复治疗', price: 120000 },
  { name: '全瓷冠', category: '修复治疗', price: 250000 },
  { name: '正畸咨询', category: '正畸治疗', price: 20000 },
  { name: '牙周基础治疗', category: '牙周病', price: 30000 },
  { name: '儿童窝沟封闭', category: '预防保健', price: 5000 },
  { name: '儿童涂氟', category: '预防保健', price: 8000 },
  { name: 'X光片(小牙片)', category: '影像学', price: 1500 },
  { name: '全景片', category: '影像学', price: 10000 },
  { name: 'CBCT', category: '影像学', price: 30000 },
  { name: '口腔检查', category: '预防保健', price: 5000 },
];

const PAY_METHODS = ['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'MEMBER_CARD', 'INSURANCE'];



const REMARKS = [
  '会员折扣',
  '老患者优惠',
  '活动特价',
  '员工内部价',
  '费用减免',
  '分期支付',
  '',
  '',
  '',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let chargeNumberCounter = 0;

export function createChargeItem(
  overrides: Partial<ChargeItemSeedData> & {
    clinicId: string;
    chargeId: string;
  },
): ChargeItemSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();

  const baseItem = overrides.name
    ? { name: overrides.name, category: overrides.category || '其他', price: overrides.price || 0 }
    : randomItem(TREATMENT_ITEMS);

  const quantity = overrides.quantity ?? randomInt(1, 3);
  const price = overrides.price ?? baseItem.price;
  const subtotal = overrides.subtotal ?? price * quantity;

  return {
    id,
    chargeId: overrides.chargeId,
    treatmentId: overrides.treatmentId || null,
    inventoryItemId: overrides.inventoryItemId || null,
    name: overrides.name || baseItem.name,
    category: overrides.category || baseItem.category,
    price,
    quantity,
    teethNumbers: overrides.teethNumbers || '[]',
    subtotal,
    clinicId: overrides.clinicId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function createCharge(
  overrides: Partial<ChargeSeedData> & {
    clinicId: string;
    patientId: string;
    doctorId?: string;
  },
  itemCount: number = 0,
): ChargeSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();
  chargeNumberCounter++;
  const number = overrides.number || `C${new Date().getFullYear()}${String(chargeNumberCounter).padStart(8, '0')}`;

  const items: ChargeItemSeedData[] = [];
  const actualItemCount = itemCount || randomInt(1, 4);
  let totalAmount = 0;

  for (let i = 0; i < actualItemCount; i++) {
    const item = createChargeItem({
      clinicId: overrides.clinicId,
      chargeId: id,
    });
    items.push(item);
    totalAmount += item.subtotal;
  }

  const discount = overrides.discount ?? (Math.random() < 0.3 ? randomInt(0, Math.floor(totalAmount * 0.2)) : 0);
  totalAmount = Math.max(0, totalAmount - discount);

  let status = overrides.status;
  let paidAmount = overrides.paidAmount ?? 0;

  if (!status) {
    const rand = Math.random();
    if (rand < 0.1) {
      status = 'UNPAID';
      paidAmount = 0;
    } else if (rand < 0.2) {
      status = 'PARTIAL';
      paidAmount = Math.floor(totalAmount * (0.3 + Math.random() * 0.6));
    } else if (rand < 0.65) {
      status = 'PAID';
      paidAmount = totalAmount;
    } else if (rand < 0.75) {
      status = 'REFUNDED';
      paidAmount = totalAmount;
    } else {
      status = 'CANCELLED';
      paidAmount = 0;
    }
  }

  const refundedAmount = overrides.refundedAmount ?? (status === 'REFUNDED' ? paidAmount : 0);

  const paidAt = status === 'PAID' || status === 'REFUNDED' || status === 'PARTIAL'
    ? (overrides.paidAt || new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString())
    : null;

  const payMethod = paidAmount > 0
    ? (overrides.payMethod || randomItem(PAY_METHODS))
    : null;

  return {
    id,
    patientId: overrides.patientId,
    visitId: overrides.visitId || null,
    doctorId: overrides.doctorId || null,
    number,
    totalAmount,
    paidAmount,
    refundedAmount,
    discount,
    status,
    payMethod,
    paidAt,
    remark: overrides.remark || randomItem(REMARKS),
    clinicId: overrides.clinicId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    items,
  };
}

export function createCharges(
  count: number,
  options: {
    clinicId: string;
    patients: Array<{ id: string }>;
    doctors?: Array<{ id: string }>;
  },
): ChargeSeedData[] {
  const result: ChargeSeedData[] = [];
  const { clinicId, patients, doctors = [] } = options;

  if (patients.length === 0) {
    return result;
  }

  for (let i = 0; i < count; i++) {
    const patient = randomItem(patients);
    const doctor = doctors.length > 0 ? randomItem(doctors) : undefined;

    result.push(
      createCharge({
        clinicId,
        patientId: patient.id,
        doctorId: doctor?.id,
      }),
    );
  }

  return result;
}

export function resetChargeNumberCounter(): void {
  chargeNumberCounter = 0;
}
