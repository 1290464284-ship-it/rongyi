import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { apiRequest } from '../../lib/api';
import { DataTable, EmptyState, LoadingState, PageError, type DataTableColumn } from '../../components';

export function GlobalSearchPage() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const query = useQuery({
    queryKey: ['global-search', q],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });

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

  const rows = query.data ?? [];
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
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
      {rows.length === 0
        ? <EmptyState message="无匹配结果" />
        : <DataTable columns={columns} rows={rows} emptyText="无匹配结果" />}
    </div>
  );
}
