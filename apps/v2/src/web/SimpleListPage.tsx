import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';

export function SimpleListPage({ title, endpoint }: { title: string; endpoint: string }) {
  const query = useQuery({
    queryKey: [endpoint],
    queryFn: () => apiRequest<unknown[]>(endpoint),
  });
  if (query.isLoading) return <div className="page">Loading...</div>;
  const rows = (query.data ?? []) as Array<Record<string, unknown>>;
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return (
    <div className="page">
      <h1>{title}</h1>
      {query.error ? <p className="error">{(query.error as Error).message}</p> : null}
      {rows.length === 0 ? <p>No data.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>{columns.map((column) => <td key={column}>{format(row[column])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

