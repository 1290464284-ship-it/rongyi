import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QueryErrorAlertProps {
  message?: string;
  onRetry?: () => void;
}

/**
 * 通用查询错误提示组件
 * 用于列表页 useQuery 的 isError 状态展示
 */
export function QueryErrorAlert({ message = '数据加载失败，请稍后重试', onRetry }: QueryErrorAlertProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-stone-500">
      <AlertCircle className="h-10 w-10 text-red-400" />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </Button>
      )}
    </div>
  );
}
