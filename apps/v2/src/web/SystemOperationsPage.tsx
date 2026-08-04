import { FormEvent, useState } from 'react';
import { apiRequest } from './api';

export function SystemOperationsPage() {
  const [resource, setResource] = useState('patients');
  const [rowsJson, setRowsJson] = useState(
    '[{"code":"IMPORT-001","name":"Imported Patient","gender":"UNKNOWN","phone":"13900000000","source":"OTHER"}]',
  );
  const [chunkSize, setChunkSize] = useState('100');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>>>([]);

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const rows = parseRows(text);
        setRowsJson(JSON.stringify(rows, null, 2));
        setMessage(`File loaded: ${rows.length} rows`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'File parse failed');
      }
    };
    reader.readAsText(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const rows = JSON.parse(rowsJson) as Array<Record<string, unknown>>;
      const result = await apiRequest<{ imported: number; failed: number; errors: string[]; chunks: number }>(
        `/bulk-import/${resource}`,
        { method: 'POST', body: JSON.stringify({ rows, chunkSize: Number(chunkSize) }) },
      );
      setMessage(`Imported ${result.imported}, failed ${result.failed}, chunks ${result.chunks}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed');
    }
  }

  async function runSearch() {
    if (search.length < 2) return;
    try {
      setSearchResults(await apiRequest<Array<Record<string, unknown>>>(`/search?q=${encodeURIComponent(search)}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed');
    }
  }

  return (
    <div className="page">
      <h1>{'\u7cfb\u7edf\u64cd\u4f5c'}</h1>
      <h2>Bulk Import</h2>
      <form className="inline-form" onSubmit={submit}>
        <select value={resource} onChange={(event) => setResource(event.target.value)}>
          <option value="patients">patients</option>
          <option value="inventoryItems">inventoryItems</option>
          <option value="suppliers">suppliers</option>
        </select>
        <textarea value={rowsJson} onChange={(event) => setRowsJson(event.target.value)} />
        <input
          aria-label="Chunk size"
          type="number"
          min={1}
          max={1000}
          value={chunkSize}
          onChange={(event) => setChunkSize(event.target.value)}
        />
        <input
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) loadFile(file);
          }}
        />
        <button type="submit">Import</button>
      </form>
      {message && <p className="info">{message}</p>}
      <h2>Global Search</h2>
      <div className="inline-form">
        <input aria-label="Search query" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button onClick={runSearch}>Search</button>
      </div>
      {searchResults.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr>{Object.keys(searchResults[0]).map((key) => <th key={key}>{key}</th>)}</tr></thead>
            <tbody>
              {searchResults.map((row, index) => (
                <tr key={index}>{Object.values(row).map((value, cellIndex) => <td key={cellIndex}>{String(value)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function parseRows(text: string): Array<Record<string, string>> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JSON must be an array of rows');
    return parsed.map((row) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error('Each JSON row must be an object');
      }
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]));
    });
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must include a header row');
  const headers = lines[0].split(',').map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
  });
}
