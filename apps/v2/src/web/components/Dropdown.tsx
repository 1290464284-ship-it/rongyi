import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

const DROPDOWN_CLOSE_MS = 140;

interface DropdownItem {
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
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setClosing(false);
    }, DROPDOWN_CLOSE_MS);
  }, [closing]);

  function toggle() {
    if (open) {
      requestClose();
      return;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setOpen(true);
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      triggerRef.current?.focus();
      return;
    }
    const currentIndex = itemRefs.current.findIndex((node) => node === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node) && !closing) requestClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, closing, requestClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="ui-dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            toggle();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            requestClose();
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div className={`ui-dropdown-menu${closing ? ' closing' : ''}`} role="menu" onKeyDown={handleMenuKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              onClick={() => { requestClose(); item.onClick?.(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
