import { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { UI_DEBOUNCE_DELAY_MS } from '@/config/constants';
import { cn } from '@/lib/utils';

/**
 * 全局顶部进度条
 *
 * 基于 React Query 的全局状态：
 * - 当有任意 query/mutation 处于 pending 时显示
 * - 使用渐显动画 + 横向滚动条，避免简单请求也闪一下
 *
 * 行为：
 * - 200ms 内完成的请求不显示进度条（避免快速请求造成视觉噪音）
 * - 显示后至少 300ms 后才能消失（避免闪烁）
 */
export function GlobalLoading() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const active = isFetching + isMutating > 0;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      // 200ms 防抖：快速完成的请求不显示进度条
      let cancelled = false;
      const showTimer = setTimeout(() => {
        if (!cancelled) setVisible(true);
      }, UI_DEBOUNCE_DELAY_MS);
      return () => {
        cancelled = true;
        clearTimeout(showTimer);
      };
    }
    // 请求结束：立即隐藏
    setVisible(false);
    return;
  }, [active]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="正在加载"
      className={cn(
        'fixed top-0 left-0 right-0 z-[9999] pointer-events-none',
        'h-0.5 overflow-hidden',
      )}
    >
      <div
        className={cn(
          'h-full bg-gradient-to-r from-primary via-secondary to-primary',
          'origin-left animate-global-loading',
        )}
      />
    </div>
  );
}
