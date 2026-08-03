import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';

export function BackupsPage() {
  const query = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/backups'),
  });

  async function create() {
    await apiRequest('/backups', { method: 'POST' });
    await query.refetch();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Backups</h1>
        <button onClick={create}>Create backup</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Filename</th><th>Size</th><th>Created</th></tr></thead>
          <tbody>
            {query.data?.map((row) => (
              <tr key={String(row.filename)}>
                <td>{String(row.filename)}</td>
                <td>{String(row.fileSize)}</td>
                <td>{String(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

