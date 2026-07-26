import * as crypto from 'node:crypto';

export interface InventoryItemSeedData {
  id: string;
  code: string;
  name: string;
  spec: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  supplierId: string | null;
  expireDate: string | null;
  location: string;
  remark: string;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { name: '口腔材料', items: [
    { name: '复合树脂', specs: ['A2色 4g', 'A3色 4g', 'B2色 4g'] },
    { name: '玻璃离子', specs: ['15g/支', '粉15g液10ml'] },
    { name: '根管糊剂', specs: ['5g/支', '套装'] },
    { name: '牙胶尖', specs: ['02锥度 25#', '04锥度 25#', '06锥度 30#'] },
    { name: '正畸托槽', specs: ['金属托槽', '陶瓷托槽', '自锁托槽'] },
  ]},
  { name: '药品', items: [
    { name: '阿莫西林胶囊', specs: ['0.5g*24粒', '0.25g*24粒'] },
    { name: '甲硝唑片', specs: ['0.2g*100片'] },
    { name: '布洛芬缓释胶囊', specs: ['0.3g*20粒'] },
    { name: '复方氯己定含漱液', specs: ['200ml/瓶', '100ml/瓶'] },
    { name: '利多卡因注射液', specs: ['2% 5ml', '2% 10ml'] },
  ]},
  { name: '一次性耗材', items: [
    { name: '一次性手套', specs: ['S码 100只/盒', 'M码 100只/盒', 'L码 100只/盒'] },
    { name: '一次性口罩', specs: ['医用外科 50只/盒', 'N95 20只/盒'] },
    { name: '一次性注射器', specs: ['5ml 100支/盒', '10ml 100支/盒'] },
    { name: '吸唾管', specs: ['100支/包'] },
    { name: '口腔检查盘', specs: ['200套/箱'] },
  ]},
  { name: '修复材料', items: [
    { name: '烤瓷合金', specs: ['50g/块'] },
    { name: '全瓷块', specs: ['A2色', 'A3色', 'B2色'] },
    { name: '印模材料', specs: ['加成型 50ml', '藻酸盐 454g'] },
    { name: '临时冠材料', specs: ['A2色 5ml', 'A3色 5ml'] },
    { name: '粘接剂', specs: ['5ml/瓶', '双管套装'] },
  ]},
  { name: '器械', items: [
    { name: '高速手机', specs: ['标准头', '大头'] },
    { name: '低速手机', specs: ['直机', '弯机'] },
    { name: '车针', specs: ['金刚砂车针套装', '钨钢车针套装'] },
    { name: '拔牙钳', specs: ['前牙钳', '磨牙钳', '智齿钳'] },
    { name: '根管锉', specs: ['K锉 25mm', 'H锉 25mm', '镍钛锉套装'] },
  ]},
];

const UNITS = ['盒', '瓶', '支', '包', '套', '箱', '个', '根'];

const LOCATIONS = ['A货架1层', 'A货架2层', 'A货架3层', 'B货架1层', 'B货架2层', 'B货架3层', 'C货架1层', '药品柜', '冷藏柜'];

const SUPPLIERS = [
  { id: 'supplier-1', name: '牙科材料供应商A' },
  { id: 'supplier-2', name: '医疗器械公司B' },
  { id: 'supplier-3', name: '医药批发C' },
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let itemCodeCounter = 0;

export function createInventoryItem(
  overrides: Partial<InventoryItemSeedData> & { clinicId: string },
): InventoryItemSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();
  itemCodeCounter++;
  const code = overrides.code || `INV${String(itemCodeCounter).padStart(6, '0')}`;

  const category = overrides.category || randomItem(CATEGORIES);
  const categoryName = typeof category === 'string' ? category : category.name;
  const itemList = typeof category === 'string' ? [{ name: '物品', specs: ['标准'] }] : category.items;
  const selectedItem = randomItem(itemList);
  const spec = overrides.spec || randomItem(selectedItem.specs);

  const stock = overrides.stock ?? randomInt(0, 500);
  const minStock = overrides.minStock ?? randomInt(10, 50);
  const price = overrides.price ?? randomInt(1000, 50000);

  const hasSupplier = Math.random() < 0.7;
  const supplierId = overrides.supplierId ?? (hasSupplier ? randomItem(SUPPLIERS).id : null);

  const hasExpireDate = Math.random() < 0.4;
  const expireDate = overrides.expireDate ?? (
    hasExpireDate
      ? new Date(Date.now() + (Math.random() * 2 - 0.5) * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null
  );

  return {
    id,
    code,
    name: overrides.name || selectedItem.name,
    spec,
    category: categoryName,
    unit: overrides.unit || randomItem(UNITS),
    stock,
    minStock,
    price,
    supplierId,
    expireDate,
    location: overrides.location || randomItem(LOCATIONS),
    remark: overrides.remark || '',
    clinicId: overrides.clinicId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function createInventoryItems(
  count: number,
  baseOverrides: Partial<InventoryItemSeedData> & { clinicId: string },
): InventoryItemSeedData[] {
  const result: InventoryItemSeedData[] = [];
  for (let i = 0; i < count; i++) {
    result.push(createInventoryItem(baseOverrides));
  }
  return result;
}

export function resetInventoryItemCodeCounter(): void {
  itemCodeCounter = 0;
}

export const SEED_SUPPLIERS = SUPPLIERS;
