import type { ReactNode } from 'react';

export interface DataTableColumn<T extends Record<string, unknown>> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  keyField,
  emptyText = '暂无数据',
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyField?: keyof T;
  emptyText?: string;
}) {
  if (rows.length === 0) return <div className="table-empty">{emptyText}</div>;
  // M2：行数上限（500），超限仅渲染前 500 行并提示，避免千行级列表全量 DOM 渲染
  const MAX_RENDER_ROWS = 500;
  const visibleRows = rows.length > MAX_RENDER_ROWS ? rows.slice(0, MAX_RENDER_ROWS) : rows;
  const tableContent = (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} style={rows.length > 100 ? { position: 'sticky', top: 0, zIndex: 1 } : undefined}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((row, index) => (
          <tr key={keyField ? String(row[keyField] ?? '') : index}>
            {columns.map((column) => (
              <td key={column.key}>
                {column.render ? column.render(row) : String(row[column.key] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="table-wrap">
      {rows.length > MAX_RENDER_ROWS && (
        <div className="table-note">仅显示前 {MAX_RENDER_ROWS} 行（共 {rows.length} 行），请使用搜索或筛选缩小范围</div>
      )}
      {rows.length > 100 ? (
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {tableContent}
        </div>
      ) : tableContent}
    </div>
  );
}
