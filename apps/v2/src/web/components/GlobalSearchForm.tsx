import { type FormEvent, type RefObject } from 'react';

export interface GlobalSearchFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function GlobalSearchForm({ value, onChange, onSubmit, inputRef }: GlobalSearchFormProps) {
  return (
    <form onSubmit={onSubmit} role="search">
      <input
        ref={inputRef}
        className="topbar-search"
        type="search"
        placeholder="全局搜索…"
        aria-label="全局搜索"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </form>
  );
}
