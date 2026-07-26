import { useState } from 'react';
import { useOperationLogs, type OperationLog } from '@/lib/api/system/operation-logs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageLoading } from '@/components/ui/loading';
import { formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const ACTION_LABEL: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '更新',
  DELETE: '删除',
  LOGIN: '登录',
  LOGOUT: '登出',
  PAY: '收费',
  REFUND: '退款',
  RESTORE: '恢复',
};

const ACTION_COLOR: Record<string, string> = {
  CREATE: 'bg-success/10 text-success',
  UPDATE: 'bg-primary/10 text-primary',
  DELETE: 'bg-destructive/10 text-destructive',
  LOGIN: 'bg-muted text-muted-foreground',
  LOGOUT: 'bg-muted text-muted-foreground',
  PAY: 'bg-info/10 text-info',
  REFUND: 'bg-warning/10 text-warning',
  RESTORE: 'bg-primary/10 text-primary',
};

const PAGE_SIZE = 20;

export default function OperationLogPage() {
  // 4.2: 接入分页，避免一次性拉取全部日志导致渲染卡顿
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useOperationLogs({ page, pageSize: PAGE_SIZE });

  const logs: OperationLog[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">操作日志</h1>

      {isLoading && <PageLoading />}

      {isError && (
        <p className="text-sm text-destructive">加载操作日志失败，请稍后重试。</p>
      )}

      {!isLoading && !isError && logs.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无操作日志</p>
      )}

      {!isLoading && !isError && logs.length > 0 && (
        <div className="rounded-lg border border-border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">{log.userName || '-'}</TableCell>
                  <TableCell>
                    <Badge className={ACTION_COLOR[log.action] || 'bg-muted text-muted-foreground'}>
                      {ACTION_LABEL[log.action] || log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {log.target || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                    {log.detail || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-sm text-muted-foreground">
            <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
