interface DateRangeProps {
  start?: string;
  end?: string;
  onChange: (start?: string, end?: string) => void;
}

export function DateRange({ start, end, onChange }: DateRangeProps) {
  return (
    <div className="ui-date-range">
      <input type="date" value={start ?? ''} aria-label="开始日期" onChange={(event) => onChange(event.target.value || undefined, end)} />
      <span className="ui-date-range-sep">→</span>
      <input type="date" value={end ?? ''} aria-label="结束日期" onChange={(event) => onChange(start, event.target.value || undefined)} />
    </div>
  );
}
