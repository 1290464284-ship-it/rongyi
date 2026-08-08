import { useEffect, type ReactNode } from 'react';

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, title, onClose, children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ui-drawer-layer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-drawer-mask" onClick={onClose} />
      <aside className="ui-drawer-panel">
        <div className="ui-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="ui-drawer-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="ui-drawer-body">{children}</div>
        {footer && <div className="ui-drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}
