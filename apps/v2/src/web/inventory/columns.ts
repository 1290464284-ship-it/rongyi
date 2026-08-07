import type { DataTableColumn } from '../components';
import { formatDateTime } from '../lib/format';
import type { InventoryReportRow } from './types';

export const detailReportColumns: DataTableColumn<InventoryReportRow>[] = [
  { key: 'createdAt', label: '时间', render: (row) => formatDateTime(row.createdAt) },
  { key: 'itemName', label: '物料', render: (row) => String(row.itemName ?? row.itemId ?? '') },
  { key: 'spec', label: '规格' },
  { key: 'category', label: '分类' },
  { key: 'unit', label: '单位' },
  { key: 'type', label: '类型' },
  { key: 'quantity', label: '数量' },
  { key: 'beforeStock', label: '变动前' },
  { key: 'afterStock', label: '变动后' },
  { key: 'referenceType', label: '参照类型' },
  { key: 'remark', label: '备注' },
];

export const summaryReportColumns: DataTableColumn<InventoryReportRow>[] = [
  { key: 'name', label: '物料', render: (row) => String(row.name ?? row.itemId ?? '') },
  { key: 'spec', label: '规格' },
  { key: 'category', label: '分类' },
  { key: 'unit', label: '单位' },
  { key: 'currentStock', label: '当前库存' },
  { key: 'inQuantity', label: '入库量' },
  { key: 'outQuantity', label: '出库量' },
  { key: 'adjustQuantity', label: '调整量' },
];
