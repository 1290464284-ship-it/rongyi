import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export interface DateRangePickerValue {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

interface DateRangePickerProps {
  value: DateRangePickerValue;
  onChange: (value: DateRangePickerValue) => void;
  showTime?: boolean;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
}

export function DateRangePicker({
  value,
  onChange,
  showTime = true,
  startLabel = '开始',
  endLabel = '结束',
  disabled = false,
}: DateRangePickerProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label>{startLabel}</Label>
        <div className="flex gap-2">
          <Input
            type="date"
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
            disabled={disabled}
            data-testid="range-start-date"
          />
          {showTime && (
            <Input
              type="time"
              value={value.startTime}
              onChange={(e) => onChange({ ...value, startTime: e.target.value })}
              disabled={disabled}
              className="w-28 shrink-0"
              data-testid="range-start-time"
            />
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{endLabel}</Label>
        <div className="flex gap-2">
          <Input
            type="date"
            value={value.endDate}
            onChange={(e) => onChange({ ...value, endDate: e.target.value })}
            disabled={disabled}
            data-testid="range-end-date"
          />
          {showTime && (
            <Input
              type="time"
              value={value.endTime}
              onChange={(e) => onChange({ ...value, endTime: e.target.value })}
              disabled={disabled}
              className="w-28 shrink-0"
              data-testid="range-end-time"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function combineDateTime(date: string, time: string): string {
  if (!date) return '';
  const t = time || '00:00';
  return `${date}T${t}:00`;
}

export function splitDateTime(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '09:00' };
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toTimeString().slice(0, 5);
    return { date, time };
  } catch {
    return { date: '', time: '09:00' };
  }
}
