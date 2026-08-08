export type ToothStatus = 'normal' | 'issue' | 'done' | 'selected';

interface DentalChartProps {
  upper: number[];
  lower: number[];
  statuses?: Record<number, ToothStatus>;
  onToothClick?: (number: number) => void;
}

export function DentalChart({ upper, lower, statuses = {}, onToothClick }: DentalChartProps) {
  const tooth = (number: number) => (
    <button
      key={number}
      type="button"
      className={`ui-tooth ${statuses[number] ?? 'normal'}`}
      onClick={() => onToothClick?.(number)}
    >
      {number}
    </button>
  );
  return (
    <div className="ui-dental-chart">
      <div className="ui-tooth-grid upper">{upper.map(tooth)}</div>
      <div className="ui-tooth-divider" />
      <div className="ui-tooth-grid lower">{lower.map(tooth)}</div>
    </div>
  );
}
