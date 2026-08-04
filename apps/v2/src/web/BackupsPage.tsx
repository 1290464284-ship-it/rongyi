import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from './api';

type DatabaseSummary = Record<string, number | string | null>;

interface RestoreStagingResult {
  message: string;
  backupSummary?: DatabaseSummary;
  currentSummary?: DatabaseSummary;
}

function SummaryPanel({ label, summary }: { label: string; summary?: DatabaseSummary }) {
  if (!summary) return <div><h2>{label}</h2><p>No summary</p></div>;
  return (
    <div>
      <h2>{label}</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {Object.entries(summary).map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BackupsPage() {
  const [message, setMessage] = useState('');
  const [comparison, setComparison] = useState<{ backup?: DatabaseSummary; current?: DatabaseSummary } | null>(null);
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
      const result = await apiRequest<RestoreStagingResult>(`/backups/${encodeURIComponent(filename)}/restore`, {
        method: 'POST',
      });
      setComparison({ backup: result.backupSummary, current: result.currentSummary });
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
      {comparison && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <SummaryPanel label="Backup summary" summary={comparison.backup} />
          <SummaryPanel label="Current summary" summary={comparison.current} />
        </div>
      )}
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
