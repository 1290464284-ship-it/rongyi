import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { DataTable } from './components';

export function SimpleListPage({ title, endpoint }: { title: string; endpoint: string }) {
  const query = useQuery({
    queryKey: [endpoint],
    queryFn: () => apiRequest<unknown[]>(endpoint),
  });
  if (query.isLoading) return <div className="page">Loading...</div>;
  const rows = (query.data ?? []) as Array<Record<string, unknown>>;
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const dataColumns = columns.map((column) => ({
    key: column,
    label: column,
    render: (row: Record<string, unknown>) => format(row[column]),
  }));
  return (
    <div className="page">
      <h1>{title}</h1>
      {query.error ? <p className="error">{(query.error as Error).message}</p> : null}
      <DataTable columns={dataColumns} rows={rows} emptyText="No data." />
    </div>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
