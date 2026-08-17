import type { DataTableColumn } from '.';

export interface ResourceTableColumnOptions {
  tableColumns: DataTableColumn<Record<string, unknown>>[];
  canDelete: boolean;
  canUpdate: boolean;
  staleRows: boolean;
  selectedIds: Set<string>;
  rows: Record<string, unknown>[];
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (row: Record<string, unknown>) => void;
}

/** 资源表格列：基础列 + 全选列（可删除时）+ 操作列（编辑/删除按能力渲染）。 */
export function resourceTableColumns(options: ResourceTableColumnOptions): DataTableColumn<Record<string, unknown>>[] {
  const {
    tableColumns,
    canDelete,
    canUpdate,
    staleRows,
    selectedIds,
    rows,
    onToggleSelect,
    onToggleSelectAll,
    onEdit,
    onDelete,
  } = options;
  return [
    ...tableColumns,
    ...(canDelete
      ? [{
          key: '_select',
          label: '',
          header: (
            <input
              type="checkbox"
              aria-label="全选当前页"
              disabled={staleRows}
              checked={rows.length > 0 && rows.every((row) => selectedIds.has(String(row.id)))}
              onChange={(event) => onToggleSelectAll(event.target.checked)}
            />
          ),
          render: (row: Record<string, unknown>) => (
            <input
              type="checkbox"
              aria-label={`选择 ${String(row.id)}`}
              disabled={staleRows}
              checked={selectedIds.has(String(row.id))}
              onChange={(event) => onToggleSelect(String(row.id), event.target.checked)}
            />
          ),
        }]
      : []),
    {
      key: '_actions',
      label: '操作',
      render: (row: Record<string, unknown>) => (
        <>
          {canUpdate && (
            <button disabled={staleRows} onClick={() => onEdit(row)}>编辑</button>
          )}
          {canDelete && (
            <button className="danger" disabled={staleRows} onClick={() => onDelete(row)}>删除</button>
          )}
        </>
      ),
    },
  ];
}
