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
  emptyText = 'No rows',
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyField: keyof T;
  emptyText?: string;
}) {
  if (rows.length === 0) return <div className="table-empty">{emptyText}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[keyField] ?? '')}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : String(row[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageError({ message }: { message: string }) {
  return <p className="error">{message}</p>;
}
