import { useMemo, useState, useEffect } from 'react';
import {
  AlertTriangle, AlertCircle, CheckCircle2, XCircle, Clock,
  Filter, RefreshCw, Search, Trash2,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogHeader, DialogTitle, DialogContent,
} from '@/components/ui/dialog';
import { DataTableWrapper } from '@/components/ui/data-table-wrapper';
import { usePaginationState } from '@/lib/hooks/use-pagination';
import { useDebounce } from '@/lib/hooks/use-debounce';
import AlertDetailDialog from './components/AlertDetailDialog';
import {
  useAlertCounts, useAlerts,
  useAcknowledgeAlert, useResolveAlert, useBatchResolveAlerts,
  ALERT_STATUS, ALERT_SEVERITY, ALERT_TYPES,
  ALERT_TYPE_LABELS,
  type AlertStatus, type AlertSeverity, type BusinessAlert, type ListAlertsParams,
} from '@/lib/api/system/business-alerts';
import { useAuthStore } from '@/lib/store/auth-store';
import { AlertKpiCard, buildAlertColumns, TIME_RANGES } from './components/alert-widgets';

export default function BusinessAlertPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const currentUserId = user?.id ?? 'current-user';

  const pagination = usePaginationState(20);

  const [searchText, setSearchText] = useState(searchParams.get('search') ?? '');
  const searchDebounced = useDebounce(searchText, 300);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>(
    (searchParams.get('status') as AlertStatus) ?? ''
  );
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | ''>(
    (searchParams.get('severity') as AlertSeverity) ?? ''
  );
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') ?? '');
  const [timeRange, setTimeRange] = useState(30);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailAlertId, setDetailAlertId] = useState<string | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [batchResolveOpen, setBatchResolveOpen] = useState(false);
  const [batchNote, setBatchNote] = useState('');

  const countsQuery = useAlertCounts({ retry: false, refetchOnWindowFocus: false });
  const counts = countsQuery.data ?? { open: 0, ack: 0, resolved: 0, critical: 0 };

  useEffect(() => {
    const next: Record<string, string> = {};
    if (statusFilter) next.status = statusFilter;
    if (severityFilter) next.severity = severityFilter;
    if (typeFilter) next.type = typeFilter;
    if (searchDebounced) next.search = searchDebounced;
    setSearchParams(next, { replace: true });
  }, [statusFilter, severityFilter, typeFilter, searchDebounced, setSearchParams]);

  const listParams = useMemo<ListAlertsParams>(() => {
    const p: ListAlertsParams = { page: pagination.page, pageSize: pagination.pageSize };
    if (statusFilter) p.status = statusFilter;
    if (severityFilter) p.severity = severityFilter;
    if (typeFilter) p.type = typeFilter;
    if (searchDebounced) p.search = searchDebounced;
    if (timeRange > 0) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - timeRange);
      p.startDate = start.toISOString().slice(0, 10);
      p.endDate = end.toISOString().slice(0, 10);
    }
    return p;
  }, [pagination.page, pagination.pageSize, statusFilter, severityFilter, typeFilter, searchDebounced, timeRange]);

  const alertsQuery = useAlerts(listParams, { retry: false, refetchOnWindowFocus: false });
  const alerts = alertsQuery.data?.items ?? [];
  const total = alertsQuery.data?.total ?? 0;

  useEffect(() => { pagination.setTotal(total); }, [total, pagination]);

  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const batchResolve = useBatchResolveAlerts();

  const handleOpenDetail = (id: string) => { setDetailAlertId(id); setDetailOpen(true); };
  const handleAcknowledge = (alert: BusinessAlert) => {
    acknowledge.mutate({ id: alert.id, acknowledgedBy: currentUserId });
  };
  const handleResolveSingle = (alert: BusinessAlert) => {
    resolve.mutate({ id: alert.id, resolvedBy: currentUserId, resolutionNote: '从列表标记解决' });
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === alerts.length && alerts.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(alerts.map((a) => a.id)));
  };

  const handleConfirmBatchResolve = () => {
    if (selectedIds.size === 0) return;
    batchResolve.mutate(
      { ids: Array.from(selectedIds), resolvedBy: currentUserId, resolutionNote: batchNote || undefined },
      { onSuccess: () => { setSelectedIds(new Set()); setBatchNote(''); setBatchResolveOpen(false); } }
    );
  };

  const handleRefresh = () => { void countsQuery.refetch(); void alertsQuery.refetch(); };

  const activeKpi =
    statusFilter === 'OPEN' ? 'open'
    : severityFilter === 'CRITICAL' || severityFilter === 'ERROR' ? 'critical'
    : statusFilter === 'ACK' ? 'ack'
    : null;

  const columns = buildAlertColumns(nav, handleOpenDetail, handleAcknowledge, handleResolveSingle, acknowledge.isPending, resolve.isPending);

  // Add select column at the beginning
  const columnsWithSelect = [
    {
      key: 'select',
      header: (
        <div className="flex items-center">
          <input data-testid="select-all-checkbox" type="checkbox" className="w-4 h-4 rounded border-border"
            checked={alerts.length > 0 && selectedIds.size === alerts.length} onChange={handleToggleSelectAll} />
        </div>
      ),
      cell: (row: BusinessAlert) => (
        <input data-testid={`row-checkbox-${row.id}`} type="checkbox" className="w-4 h-4 rounded border-border"
          checked={selectedIds.has(row.id)} onChange={() => handleToggleSelect(row.id)} />
      ),
      width: '40px',
      className: 'w-10',
    },
    ...columns,
  ];

  const isEmpty = !alertsQuery.isLoading && !alertsQuery.isError && alerts.length === 0;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto" data-testid="business-alert-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-50 border border-red-100">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">经营异常预警</h1>
            <p className="text-sm text-muted-foreground">监控经营健康度，及时发现并处理异常</p>
          </div>
        </div>
        <Button data-testid="refresh-btn" variant="outline" size="sm" onClick={handleRefresh}
          disabled={countsQuery.isLoading || alertsQuery.isLoading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${countsQuery.isLoading || alertsQuery.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <AlertKpiCard label="未解决" value={counts.open} icon={Clock} bgClass="bg-yellow-50" iconClass="text-yellow-600"
          loading={countsQuery.isLoading} active={activeKpi === 'open'}
          onClick={() => { setStatusFilter(statusFilter === 'OPEN' ? '' : 'OPEN'); setSeverityFilter(''); }} />
        <AlertKpiCard label="严重/错误" value={counts.critical} icon={XCircle} bgClass="bg-red-50" iconClass="text-red-600"
          loading={countsQuery.isLoading} active={activeKpi === 'critical'}
          onClick={() => { setSeverityFilter(severityFilter === 'CRITICAL' ? '' : 'CRITICAL'); setStatusFilter(''); }} />
        <AlertKpiCard label="待确认" value={counts.ack} icon={AlertCircle} bgClass="bg-blue-50" iconClass="text-blue-600"
          loading={countsQuery.isLoading} active={activeKpi === 'ack'}
          onClick={() => { setStatusFilter(statusFilter === 'ACK' ? '' : 'ACK'); setSeverityFilter(''); }} />
        <AlertKpiCard label="已解决本月" value={counts.resolved} icon={CheckCircle2} bgClass="bg-green-50" iconClass="text-green-600"
          loading={countsQuery.isLoading} onClick={() => { setStatusFilter(statusFilter === 'RESOLVED' ? '' : 'RESOLVED'); setSeverityFilter(''); }}
          active={statusFilter === 'RESOLVED'} />
      </div>

      <Card>
        <CardContent className="p-4 pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[280px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid="search-input" value={searchText} onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索消息/类型/实体ID..." className="pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">状态</Label>
              <Select data-testid="filter-status" value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AlertStatus | '')} className="h-9 min-w-[120px]">
                <option value="">全部</option>
                <option value={ALERT_STATUS.OPEN}>待处理</option>
                <option value={ALERT_STATUS.ACK}>已确认</option>
                <option value={ALERT_STATUS.RESOLVED}>已解决</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">严重度</Label>
              <Select data-testid="filter-severity" value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | '')} className="h-9 min-w-[100px]">
                <option value="">全部</option>
                <option value={ALERT_SEVERITY.CRITICAL}>严重</option>
                <option value={ALERT_SEVERITY.ERROR}>错误</option>
                <option value={ALERT_SEVERITY.WARN}>警告</option>
                <option value={ALERT_SEVERITY.INFO}>信息</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">类型</Label>
              <Select data-testid="filter-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 min-w-[140px]">
                <option value="">全部类型</option>
                {Object.entries(ALERT_TYPES).map(([k, v]) => (
                  <option key={k} value={v}>{ALERT_TYPE_LABELS[v] ?? k}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select data-testid="filter-time-range" value={String(timeRange)}
                onChange={(e) => setTimeRange(Number(e.target.value))} className="h-9 min-w-[110px]">
                {TIME_RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
              </Select>
            </div>
            {selectedIds.size > 0 && (
              <Button data-testid="batch-resolve-btn" variant="default" size="sm"
                onClick={() => setBatchResolveOpen(true)} className="ml-auto">
                <CheckCircle2 className="w-4 h-4 mr-1" />批量解决 ({selectedIds.size})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <DataTableWrapper<BusinessAlert>
          columns={columnsWithSelect}
          data={alerts}
          loading={alertsQuery.isLoading}
          isEmpty={isEmpty}
          emptyText="暂无告警"
          emptySubtitle="所有经营指标正常"
          rowKey={(r) => r.id}
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          showPagination
          skeletonRows={5}
          className="min-h-[400px]"
        />
      </Card>

      <AlertDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} alertId={detailAlertId} />

      <Dialog open={batchResolveOpen} onClose={() => !batchResolve.isPending && setBatchResolveOpen(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="batch-resolve-title">
            批量解决告警 ({selectedIds.size} 条)
          </DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="bg-muted/40 border border-border rounded-md p-3 text-sm text-muted-foreground">
            <Trash2 className="w-4 h-4 inline mr-2 text-orange-600" />
            将把所选的 {selectedIds.size} 条告警标记为已解决，操作不可撤销。
          </div>
          <div>
            <Label htmlFor="batch-note">解决备注（可选）</Label>
            <Textarea id="batch-note" data-testid="batch-note-textarea" value={batchNote}
              onChange={(e) => setBatchNote(e.target.value)} placeholder="输入批量解决说明..." className="mt-2" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setBatchResolveOpen(false)} disabled={batchResolve.isPending}>
              取消
            </Button>
            <Button data-testid="batch-resolve-confirm" size="sm" onClick={handleConfirmBatchResolve} disabled={batchResolve.isPending}>
              {batchResolve.isPending ? '处理中...' : '确认批量解决'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
