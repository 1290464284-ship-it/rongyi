import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
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
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

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

  return (
    <div className="ui-multiselect" ref={rootRef}>
      <div className="ui-multiselect-input" onClick={() => { setOpen((current) => !current); setQuery(''); }}>
        {selected.map((option) => (
          <span key={option.value} className="ui-chip">{option.label}</span>
        ))}
        <span className="ui-multiselect-placeholder">{selected.length === 0 ? placeholder : ''}</span>
      </div>
      {open && (
        <div className="ui-multiselect-menu">
          <input
            className="ui-multiselect-search"
            type="search"
            placeholder="搜索"
            aria-label="筛选选项"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {visibleOptions.map((option) => (
            <label key={option.value} className="ui-multiselect-option">
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
