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

  return (
    <div className="ui-multiselect" ref={rootRef}>
      <div className="ui-multiselect-input" onClick={() => setOpen((current) => !current)}>
        {selected.map((option) => (
          <span key={option.value} className="ui-chip">{option.label}</span>
        ))}
        <span className="ui-multiselect-placeholder">{selected.length === 0 ? placeholder : ''}</span>
      </div>
      {open && (
        <div className="ui-multiselect-menu">
          {options.map((option) => (
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
