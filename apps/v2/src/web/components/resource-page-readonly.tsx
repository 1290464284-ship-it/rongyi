import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { DataTable, LoadingState, PageError } from '.';
import { formatDate, formatDateTime, formatDisplayValue, formatMoney } from '../lib/format';
import { SIMPLE_LIST_COLUMN_LABELS } from '../lib/labels';
import { csvCell, downloadTextFile } from '../lib/csv';
import { DATE_COLUMNS, DATETIME_COLUMNS, MONEY_COLUMNS } from './resource-page-constants';

/** 只读统计端点表格的列类型（W-8：meta 优先于列名白名单启发式）。 */
export type StatColumnType = 'money' | 'date' | 'datetime' | 'count' | 'text';

function formatStatValue(column: string, value: unknown, columnType?: StatColumnType): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (columnType === 'money' || MONEY_COLUMNS.has(column)) return formatMoney(value);
  if (columnType === 'datetime' || DATETIME_COLUMNS.has(column)) return formatDateTime(value);
  if (columnType === 'date' || DATE_COLUMNS.has(column)) return formatDate(value);
  return formatDisplayValue(value);
}

export function ReadOnlyListPage({ title, endpoint, columnTypes }: { title: string; endpoint: string; columnTypes?: Record<string, StatColumnType> }) {
  const query = useQuery({
    queryKey: ['stat', endpoint],
    queryFn: () => apiRequest<Array<Record<string, unknown>> | { items: Array<Record<string, unknown>>; truncated?: boolean }>(endpoint),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const raw = (query.data ?? []) as Array<Record<string, unknown>> | { items?: Array<Record<string, unknown>>; truncated?: boolean };
  const rows = Array.isArray(raw) ? raw : (raw.items ?? []);
  const truncated = !Array.isArray(raw) && Boolean(raw.truncated);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const dataColumns = columns.map((column) => ({
    key: column,
    label: SIMPLE_LIST_COLUMN_LABELS[column] ?? column,
    // W-8：显式列类型元数据优先，未声明时按扩展白名单/值兜底。
    render: (row: Record<string, unknown>) => formatStatValue(column, row[column], columnTypes?.[column]),
  }));
  function exportCsv() {
    /* v8 ignore next -- 导出按钮在 truncated 时 disabled，onClick 不会触发 */
    if (truncated) return;
    const lines: string[] = [];
    lines.push(columns.map((column) => csvCell(SIMPLE_LIST_COLUMN_LABELS[column] ?? column)).join(','));
    for (const row of rows) {
      lines.push(columns.map((column) => csvCell(row[column])).join(','));
    }
    downloadTextFile(`${title}.csv`, lines.join('\n'));
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <button onClick={exportCsv} disabled={truncated}>导出</button>
      </div>
      {truncated && <p className="reminder-muted">{'\u8d85\u8fc7\u663e\u793a\u4e0a\u9650\uff0c\u4ec5\u663e\u793a\u90e8\u5206\u6570\u636e'}</p>}
      <DataTable columns={dataColumns} rows={rows} emptyText="暂无数据" />
    </div>
  );
}
