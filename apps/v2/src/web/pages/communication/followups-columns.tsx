import type { DataTableColumn } from '../../components';

export function followUpColumns(handlers: {
  selectedIds: string[];
  disabled: boolean;
  stale: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onComplete: (row: Record<string, unknown>) => void;
  onExecute: (id: string) => void;
}): DataTableColumn<Record<string, unknown>>[] {
  const { selectedIds, disabled, stale, onToggleSelect, onComplete, onExecute } = handlers;
  return [
    {
      key: 'selected',
      label: '选择',
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`选择 ${String(row.id)}`}
          disabled={disabled || stale}
          checked={selectedIds.includes(String(row.id))}
          onChange={(event) => onToggleSelect(String(row.id), event.target.checked)}
        />
      ),
    },
    {
      key: 'patient',
      label: '患者',
      render: (row) => String(row.patientName ?? row.patientId ?? ''),
    },
    { key: 'planDate', label: '计划日期', render: (row) => String(row.planDate ?? '') },
    { key: 'status', label: '状态', render: (row) => String(row.status ?? '') },
    { key: 'content', label: '内容', render: (row) => String(row.content ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <span>
          <button disabled={stale} onClick={() => onComplete(row)}>完成随访</button>
          <button disabled={stale} onClick={() => onExecute(String(row.id))}>执行随访</button>
        </span>
      ),
    },
  ];
}
