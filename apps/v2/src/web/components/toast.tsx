import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastKind } from '../lib/toast-context';

const TOAST_LIFETIME_MS = 4200;
const TOAST_EXIT_MS = 200;

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [leavingIds, setLeavingIds] = useState<Set<number>>(() => new Set());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextIdRef = useRef(0);

  useEffect(() => {
    const current = timers.current;
    return () => {
      for (const timer of current.values()) clearTimeout(timer);
      current.clear();
    };
  }, []);

  const nextId = useCallback(() => {
    nextIdRef.current += 1;
    return nextIdRef.current;
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId();
    setToasts((current) => [...current, { id, kind, message }]);
    // 先播退出动画，动画结束后再移除 DOM（与 Dialog/Drawer 关闭口径一致）
    const timer = setTimeout(() => {
      setLeavingIds((current) => new Set(current).add(id));
      timers.current.set(id, setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        setLeavingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        timers.current.delete(id);
      }, TOAST_EXIT_MS));
    }, TOAST_LIFETIME_MS);
    timers.current.set(id, timer);
  }, [nextId]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}${leavingIds.has(toast.id) ? ' leaving' : ''}`}>{toast.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
