import type { DataTableColumn } from '../components';

export function narcoticColumns(handlers: {
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (row: Record<string, unknown>) => void;
}): DataTableColumn<Record<string, unknown>>[] {
  const { onEdit, onDelete } = handlers;
  return [
    { key: 'recordDate', label: '日期' },
    { key: 'itemName', label: '物品', render: (row) => String(row.itemName ?? row.itemId ?? '') },
    { key: 'batchNo', label: '批号', render: (row) => String(row.batchNo ?? '') },
    { key: 'quantity', label: '数量', render: (row) => String(row.quantity ?? '') },
    { key: 'usage', label: '用途', render: (row) => String(row.usage ?? '') },
    { key: 'balanceBefore', label: '余量前', render: (row) => String(row.balanceBefore ?? '') },
    { key: 'balanceAfter', label: '余量后', render: (row) => String(row.balanceAfter ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <span className="row-actions">
          <button type="button" onClick={() => onEdit(row)}>编辑</button>
          <button type="button" onClick={() => onDelete(row)}>删除</button>
        </span>
      ),
    },
  ];
}
