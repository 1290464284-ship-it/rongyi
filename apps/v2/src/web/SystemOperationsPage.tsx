import { FormEvent, useState } from 'react';
import { apiRequest } from './api';

export function SystemOperationsPage() {
  const [resource, setResource] = useState('patients');
  const [rowsJson, setRowsJson] = useState('[{"code":"IMPORT-001","name":"Imported Patient","gender":"UNKNOWN","phone":"13900000000","source":"OTHER"}]');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>>>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const rows = JSON.parse(rowsJson) as Array<Record<string, unknown>>;
      const result = await apiRequest<{ imported: number; failed: number; errors: string[] }>(
        `/bulk-import/${resource}`,
        { method: 'POST', body: JSON.stringify({ rows }) },
      );
      setMessage(`导入成功 ${result.imported} 条，失败 ${result.failed} 条`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    }
  }

  async function runSearch() {
    if (search.length < 2) return;
    try {
      setSearchResults(await apiRequest<Array<Record<string, unknown>>>(`/search?q=${encodeURIComponent(search)}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '搜索失败');
    }
  }

  return (
    <div className="page">
      <h1>系统操作</h1>
      <h2>批量导入</h2>
      <form className="inline-form" onSubmit={submit}>
        <select value={resource} onChange={(event) => setResource(event.target.value)}>
          <option value="patients">patients</option>
          <option value="inventoryItems">inventoryItems</option>
          <option value="suppliers">suppliers</option>
        </select>
        <textarea value={rowsJson} onChange={(event) => setRowsJson(event.target.value)} />
        <button type="submit">导入</button>
      </form>
      {message && <p className="info">{message}</p>}
      <h2>全局搜索</h2>
      <div className="inline-form">
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
        <button onClick={runSearch}>搜索</button>
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

