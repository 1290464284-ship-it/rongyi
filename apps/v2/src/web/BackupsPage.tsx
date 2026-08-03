import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from './api';

export function BackupsPage() {
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/backups'),
  });

  async function create() {
    try {
      const result = await apiRequest<{ filename: string; encrypted: boolean }>('/backups', { method: 'POST' });
      setMessage(`Backup created: ${result.filename}${result.encrypted ? ' (encrypted)' : ''}`);
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Create failed');
    }
  }

  async function verify(filename: string) {
    try {
      const result = await apiRequest<{ integrity: string }>(`/backups/${encodeURIComponent(filename)}/verify`);
      setMessage(`Integrity: ${result.integrity}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Verify failed');
    }
  }

  async function stageRestore(filename: string) {
    try {
      const result = await apiRequest<{ message: string }>(`/backups/${encodeURIComponent(filename)}/restore`, {
        method: 'POST',
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Restore staging failed');
    }
  }

  async function cleanup() {
    try {
      const result = await apiRequest<{ kept: number; deleted: Array<{ filename: string }> }>('/backups/cleanup', {
        method: 'POST',
        body: JSON.stringify({ maxKeep: 30 }),
      });
      setMessage(`Kept ${result.kept}, deleted ${result.deleted.length}`);
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cleanup failed');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Backups</h1>
        <button onClick={create}>Create backup</button>
        <button onClick={cleanup}>Cleanup (keep 30)</button>
      </div>
      {message && <p className="info">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Filename</th><th>Encrypted</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {query.data?.map((row) => (
              <tr key={String(row.filename)}>
                <td>{String(row.filename)}</td>
                <td>{String(Boolean(row.encrypted))}</td>
                <td>{String(row.fileSize)}</td>
                <td>{String(row.createdAt)}</td>
                <td className="actions">
                  <button onClick={() => verify(String(row.filename))}>Verify</button>
                  <button onClick={() => stageRestore(String(row.filename))}>Stage restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
