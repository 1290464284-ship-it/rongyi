import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

const MULTISELECT_CLOSE_MS = 140;

interface SelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  value: string[];
  options: SelectOption[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export function MultiSelect({ value, options, onChange, placeholder = '请选择' }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setClosing(false);
    }, MULTISELECT_CLOSE_MS);
  }, [closing]);

  function toggleOpen() {
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
    setQuery('');
    setActiveIndex(0);
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

  function toggle(optionValue: string) {
    onChange(value.includes(optionValue)
      ? value.filter((item) => item !== optionValue)
      : [...value, optionValue]);
  }

  const selected = options.filter((option) => value.includes(option.value));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;
  const activeOption = visibleOptions[activeIndex] ?? null;

  return (
    <div className="ui-multiselect" ref={rootRef}>
      <div
        ref={triggerRef}
        className="ui-multiselect-input"
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={placeholder}
        onClick={toggleOpen}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            toggleOpen();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            requestClose();
          }
        }}
      >
        {selected.map((option) => (
          <span key={option.value} className="ui-chip">{option.label}</span>
        ))}
        <span className="ui-multiselect-placeholder">{selected.length === 0 ? placeholder : ''}</span>
      </div>
      {open && (
        <div
          className={`ui-multiselect-menu${closing ? ' closing' : ''}`}
          role="listbox"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              requestClose();
              triggerRef.current?.focus();
            }
          }}
        >
          <input
            className="ui-multiselect-search"
            type="search"
            placeholder="搜索"
            aria-label="筛选选项"
            aria-activedescendant={activeOption ? `multiselect-option-${activeOption.value}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => Math.min(visibleOptions.length - 1, current + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (activeOption) toggle(activeOption.value);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                requestClose();
                triggerRef.current?.focus();
              }
            }}
          />
          {visibleOptions.map((option) => (
            <label
              key={option.value}
              id={`multiselect-option-${option.value}`}
              className="ui-multiselect-option"
              role="option"
              aria-selected={value.includes(option.value)}
            >
              <input
                type="checkbox"
                checked={value.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
