import { CheckCircle2, XCircle, AlertCircle, Upload, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingButton } from '@/components/ui/loading';
import { cn } from '@/lib/utils';
import type { ImportSummary, RowError } from '@/lib/api/system/bulk-import';

interface ImportSummaryCardProps {
  summary: ImportSummary;
  importing: boolean;
  onImport: () => void;
}

export default function ImportSummaryCard({ summary, importing, onImport }: ImportSummaryCardProps) {
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {summary.failedCount > 0 ? (
            <XCircle className="h-5 w-5 text-destructive" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          )}
          <CardTitle className="text-sm font-medium">
            {summary.dryRun ? '校验结果' : '导入结果'}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div
            className={cn(
              'rounded-lg border p-4 text-center',
              'border-green-200 bg-green-50',
            )}
            data-testid="kpi-success"
          >
            <div className="text-2xl font-bold text-green-700">{summary.successCount}</div>
            <div className="text-xs text-green-700/80 mt-1">成功</div>
          </div>
          <div
            className={cn(
              'rounded-lg border p-4 text-center',
              summary.failedCount > 0
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-border bg-muted/30',
            )}
            data-testid="kpi-failed"
          >
            <div
              className={cn(
                'text-2xl font-bold',
                summary.failedCount > 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {summary.failedCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">失败</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-center" data-testid="kpi-skipped">
            <div className="text-2xl font-bold text-muted-foreground">{summary.skippedCount}</div>
            <div className="text-xs text-muted-foreground mt-1">跳过</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground text-center">
          总计 {summary.total} 条记录
          {summary.durationMs !== undefined && ` · 耗时 ${summary.durationMs}ms`}
        </div>

        {summary.failedCount > 0 && summary.errors.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-destructive" />
              失败行详情（前 50 条）
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <Table data-testid="error-table">
                  <TableHeader className="sticky top-0 bg-destructive/5 backdrop-blur">
                    <TableRow>
                      <TableHead className="w-20">行号</TableHead>
                      <TableHead className="w-32">字段</TableHead>
                      <TableHead className="w-32">错误码</TableHead>
                      <TableHead>错误信息</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.errors.slice(0, 50).map((err: RowError, i: number) => (
                      <TableRow key={i} className="bg-destructive/5 hover:bg-destructive/10">
                        <TableCell className="font-mono text-xs text-destructive">
                          {err.rowNumber}
                        </TableCell>
                        <TableCell className="text-xs">{err.field ?? '-'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {err.errorCode}
                        </TableCell>
                        <TableCell className="text-xs text-destructive">{err.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {summary.dryRun && summary.failedCount === 0 && (
          <div className="flex items-center justify-end gap-3 pt-2">
            <LoadingButton
              onClick={onImport}
              loading={importing}
              loadingText="导入中…"
              disabled={importing}
              data-testid="import-btn"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              正式导入 {summary.successCount} 条
            </LoadingButton>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
