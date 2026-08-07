import { FormEvent, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { useDebouncedValue } from '../../hooks/use-debounce';

export function SystemOperationsPage() {
  const { showToast } = useToast();
  const [resource, setResource] = useState('patients');
  const [rowsJson, setRowsJson] = useState(
    '[{"code":"IMPORT-001","name":"导入患者","gender":"UNKNOWN","phone":"13900000000","source":"OTHER"}]',
  );
  const [chunkSize, setChunkSize] = useState('100');
  const [auditRetentionDays, setAuditRetentionDays] = useState('365');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>>>([]);

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const rows = parseRows(text);
        setRowsJson(JSON.stringify(rows, null, 2));
        showToast(`已加载 ${rows.length} 行`, 'success');
      } catch (error) {
        showToast(errorMessage(error, '文件解析失败'), 'error');
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
      showToast(`导入完成：成功 ${result.imported}，失败 ${result.failed}，分片 ${result.chunks}`, 'success');
    } catch (error) {
      showToast(errorMessage(error, '导入失败'), 'error');
    }
  }

  async function runSearch() {
    if (search.length < 2) return;
    try {
      setSearchResults(await apiRequest<Array<Record<string, unknown>>>(`/search?q=${encodeURIComponent(search)}`));
      showToast('搜索完成', 'success');
    } catch (error) {
      showToast(errorMessage(error, '搜索失败'), 'error');
    }
  }

  async function cleanupAuditLogs() {
    const retentionDays = Number(auditRetentionDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
      showToast('日志保留天数必须在 30 到 3650 之间', 'error');
      return;
    }
    try {
      const result = await apiRequest<{ deleted: number }>('/system/audit/cleanup', {
        method: 'POST',
        body: JSON.stringify({ retentionDays }),
      });
      showToast(`已清理 ${result.deleted} 条过期日志`, 'success');
    } catch (error) {
      showToast(errorMessage(error, '清理日志失败'), 'error');
    }
  }

  return (
    <div className="page">
      <h1>{'\u7cfb\u7edf\u64cd\u4f5c'}</h1>
      <h2>批量导入</h2>
      <form className="inline-form" onSubmit={submit}>
        <select value={resource} onChange={(event) => setResource(event.target.value)}>
          <option value="patients">患者</option>
          <option value="inventoryItems">库存项目</option>
          <option value="suppliers">供应商</option>
        </select>
        <textarea value={rowsJson} onChange={(event) => setRowsJson(event.target.value)} />
        <input
          aria-label="分片大小"
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
        <button type="submit">导入</button>
      </form>
      <h2>全局搜索</h2>
      <div className="inline-form">
        <input aria-label="搜索关键词" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        <button onClick={runSearch}>搜索</button>
      </div>
      {searchResults.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr>{Object.keys(searchResults[0]).map((key) => <th key={key}>{key}</th>)}</tr></thead>
            <tbody>
              {searchResults.map((row, index) => (
                // L5：用行 id 作 key；搜索跨资源（患者/库存/供应商），无 id 时回退索引
                <tr key={String(row.id ?? index)}>{Object.values(row).map((value, cellIndex) => <td key={cellIndex}>{String(value)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>审计日志清理</h2>
      <div className="inline-form">
        <input
          aria-label="日志保留天数"
          type="number"
          min={30}
          max={3650}
          value={auditRetentionDays}
          onChange={(event) => setAuditRetentionDays(event.target.value)}
        />
        <button onClick={cleanupAuditLogs}>立即清理</button>
      </div>
    </div>
  );
}

function parseRows(text: string): Array<Record<string, string>> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JSON 必须是行数组');
    return parsed.map((row) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error('JSON 每行必须是对象');
      }
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]));
    });
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV 必须包含表头行');
  const headers = splitCsvRow(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
  });
}

function splitCsvRow(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}
