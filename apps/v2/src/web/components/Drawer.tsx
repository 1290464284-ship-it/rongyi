import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { registerModalLayer } from '../lib/modal-a11y';

/** 关闭动画时长 140ms，卸载延时须大于动画时长（防闪回：fill-mode forwards） */
const DRAWER_CLOSE_MS = 160;

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, title, onClose, children, footer }: DrawerProps) {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  // 重新打开时复位关闭动画状态，并丢弃未完成的关闭定时器
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setClosing(false);
  }

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      closingRef.current = false;
      onClose();
    }, DRAWER_CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const panel = drawerRef.current;
    const cleanupInert = panel ? registerModalLayer(panel) : null;
    const focusable = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
    return () => {
      cleanupInert?.();
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  if (!open) return null;
  return (
    <div
      ref={drawerRef}
      className={`ui-drawer-layer${closing ? ' closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="ui-drawer-mask" onClick={requestClose} />
      <aside className="ui-drawer-panel">
        <div className="ui-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="ui-drawer-close" onClick={requestClose} aria-label="关闭">×</button>
        </div>
        <div className="ui-drawer-body">{children}</div>
        {footer && <div className="ui-drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}
