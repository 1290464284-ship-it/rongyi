import { ReactNode } from 'react';
import { Inbox, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Button } from './button';

export interface DataTableColumn<T extends object = Record<string, unknown>> {
  key: string;
  header: ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T, index: number) => ReactNode;
  className?: string;
  width?: string;
}

export interface DataTableWrapperProps<T extends object = Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  isEmpty?: boolean;
  emptyText?: string;
  emptySubtitle?: string;
  rowKey?: (row: T, index: number) => string;
  className?: string;
  tableClassName?: string;

  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;

  showPagination?: boolean;
  skeletonRows?: number;
}

function SkeletonRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      {Array.from({ length: colSpan }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 bg-muted/50 rounded animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export function DataTableWrapper<T extends object>({
  columns,
  data,
  loading = false,
  isEmpty = false,
  emptyText = '暂无数据',
  emptySubtitle,
  rowKey,
  className,
  tableClassName,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  pageSizeOptions = [10, 20, 50, 100],
  onPageSizeChange,
  showPagination = true,
  skeletonRows = 5,
}: DataTableWrapperProps<T>) {
  const totalPages = Math.ceil(total / pageSize) || 1;
  const actualIsEmpty = !loading && data.length === 0 && isEmpty;

  const getRowKey = (row: T, index: number): string => {
    if (rowKey) return rowKey(row, index);
    if ('id' in row && row.id) return String(row.id);
    return String(index);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex-1 overflow-auto">
        <Table className={cn(tableClassName)}>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={cn(col.className)} style={col.width ? { width: col.width } : undefined}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: skeletonRows }).map((_, i) => (
              <SkeletonRow key={`skeleton-${i}`} colSpan={columns.length} />
            ))}

            {!loading && actualIsEmpty && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center">
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                      <Inbox className="w-6 h-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{emptyText}</p>
                    {emptySubtitle && (
                      <p className="text-xs text-muted-foreground">{emptySubtitle}</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}

            {!loading && !actualIsEmpty && data.map((row, rowIndex) => (
              <TableRow key={getRowKey(row, rowIndex)}>
                {columns.map((col) => (
                  <TableCell key={col.key} className={cn(col.className)}>
                    {col.cell ? col.cell(row, rowIndex) : col.accessorKey ? String(row[col.accessorKey] ?? '') : null}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {showPagination && total > 0 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border mt-auto">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>共 {total} 条</span>
            {onPageSizeChange && (
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="h-8 px-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>{size} 条/页</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canPrev}
              onClick={() => onPageChange?.(1)}
              aria-label="首页"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canPrev}
              onClick={() => onPageChange?.(page - 1)}
              aria-label="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground min-w-[60px] text-center">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canNext}
              onClick={() => onPageChange?.(page + 1)}
              aria-label="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canNext}
              onClick={() => onPageChange?.(totalPages)}
              aria-label="末页"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
