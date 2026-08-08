import { useEffect, useRef, useState } from 'react';

export interface DropdownItem {
  label: string;
  danger?: boolean;
  onClick?: () => void;
}

interface DropdownProps {
  label: string;
  items: DropdownItem[];
}

export function Dropdown({ label, items }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="ui-dropdown" ref={rootRef}>
      <button type="button" className="ui-dropdown-trigger" onClick={() => setOpen((value) => !value)}>{label}</button>
      {open && (
        <div className="ui-dropdown-menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={item.danger ? 'danger' : ''}
              onClick={() => { setOpen(false); item.onClick?.(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
