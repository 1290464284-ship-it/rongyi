type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

interface ProgressProps {
  value: number;
  max?: number;
  tone?: ProgressTone;
}

export function Progress({ value, max = 100, tone = 'primary' }: ProgressProps) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="ui-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`ui-progress-fill ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
