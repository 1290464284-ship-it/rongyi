import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastKind } from '../lib/toast-context';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      timers.current.delete(id);
    }, 4200);
    timers.current.set(id, timer);
  }, [nextId]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
