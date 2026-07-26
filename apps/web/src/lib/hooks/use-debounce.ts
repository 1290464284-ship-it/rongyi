/**
 * 防抖 Hook
 *
 * 延迟更新值，适用于搜索输入框等场景。
 * 避免每次按键都触发 API 请求。
 *
 * @example
 * const [search, setSearch] = useState('');
 * const debouncedSearch = useDebounce(search, 300);
 * useQuery({ queryKey: ['patients', debouncedSearch], ... });
 */
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
