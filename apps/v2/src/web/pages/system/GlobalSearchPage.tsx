import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { apiRequest } from '../../lib/api';
import { DataTable, EmptyState, LoadingState, PageError, type DataTableColumn } from '../../components';

export function GlobalSearchPage() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const [filter, setFilter] = useState('all');
  const [prevQuery, setPrevQuery] = useState(q);
  if (prevQuery !== q) {
    setPrevQuery(q);
    setFilter('all');
  }
  const query = useQuery({
    queryKey: ['global-search', q],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const resources = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.resource ?? '')))),
    [rows],
  );
  const filteredRows = useMemo(
    () => (filter === 'all' ? rows : rows.filter((row) => String(row.resource ?? '') === filter)),
    [rows, filter],
  );
  const keys = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
    [rows],
  );

  if (q.length < 2) {
    return (
      <div className="page">
        <div className="page-head"><h1>全局搜索</h1></div>
        <EmptyState message="输入至少 2 个字符开始搜索" />
      </div>
    );
  }
  if (query.isLoading) return <LoadingState label="全局搜索中..." />;
  if (query.error) {
    return (
      <div className="page">
        <div className="page-head"><h1>全局搜索</h1></div>
        <PageError message={query.error instanceof Error ? query.error.message : String(query.error)} />
      </div>
    );
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = keys.map((key) => ({
    key,
    label: key,
    render: (row) => String(row[key] ?? ''),
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h1>全局搜索</h1>
        <span className="table-muted">{rows.length} 条结果</span>
      </div>
      <div className="inline-form">
        {[['all', '全部'], ...resources.map((resource) => [resource, RESOURCE_LABELS[resource] ?? resource] as [string, string])].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'tab active' : 'tab'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="inline-form">
        {[
          ['患者档案', `/patients?q=${encodeURIComponent(q)}`],
          ['库存', `/inventory?q=${encodeURIComponent(q)}`],
          ['收费', `/finance?q=${encodeURIComponent(q)}`],
          ['预约', `/front-desk?q=${encodeURIComponent(q)}`],
        ].map(([label, href]) => (
          <Link key={String(label)} to={href} className="btn-secondary">{String(label)}</Link>
        ))}
      </div>
      {rows.length === 0
        ? <EmptyState message="无匹配结果" />
        : <DataTable columns={columns} rows={filteredRows} emptyText="无匹配结果" />}
    </div>
  );
}

const RESOURCE_LABELS: Record<string, string> = {
  patients: '患者',
  inventoryItems: '库存',
  appointments: '预约',
  charges: '收费',
  followUps: '随访',
  suppliers: '供应商',
};
