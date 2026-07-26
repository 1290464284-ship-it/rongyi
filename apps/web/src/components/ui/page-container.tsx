import { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from './loading';
import { Button } from './button';

export interface PageContainerProps {
  children: ReactNode;
  className?: string;
  loading?: boolean;
  error?: Error | null;
  isEmpty?: boolean;
  emptyText?: string;
  emptySubtitle?: string;
  onRetry?: () => void;
  loadingText?: string;
  errorText?: string;
  maxWidth?: string;
  padding?: string;
}

export function PageContainer({
  children,
  className,
  loading = false,
  error = null,
  isEmpty = false,
  emptyText = '暂无数据',
  emptySubtitle,
  onRetry,
  loadingText = '加载中…',
  errorText = '加载失败',
  maxWidth = 'max-w-7xl',
  padding = 'p-6',
}: PageContainerProps) {
  const content = (() => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Spinner size="lg" className="mb-3" />
          <p className="text-sm">{loadingText}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">{errorText}</p>
          <p className="text-xs text-muted-foreground mb-4 max-w-md">
            {error.message || '请检查网络连接后重试'}
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              重新加载
            </Button>
          )}
        </div>
      );
    }

    if (isEmpty) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Inbox className="w-6 h-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">{emptyText}</p>
          {emptySubtitle && (
            <p className="text-xs text-muted-foreground">{emptySubtitle}</p>
          )}
        </div>
      );
    }

    return children;
  })();

  return (
    <div className={cn('w-full mx-auto', maxWidth, padding, className)}>
      {content}
    </div>
  );
}
