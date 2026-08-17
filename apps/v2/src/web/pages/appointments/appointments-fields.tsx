import { MissingSelectOption } from '../../components';
import { APPOINTMENT_TYPE_LABELS } from '../../lib/labels';
import type { PurposeRow } from '../../appointments/types';

/** 预约类型下拉：创建与编辑表单共用，文案与 aria-label 必须保持一致。 */
export function AppointmentTypeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select aria-label="预约类型" value={value} onChange={(event) => onChange(event.target.value)}>
      {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}

/** 预约事项下拉：创建与编辑表单共用，包含“不指定”占位与缺失值兜底。 */
export function AppointmentPurposeSelect({ value, onChange, items, missing }: {
  value: string;
  onChange: (value: string) => void;
  items: PurposeRow[] | undefined;
  missing: (id: string) => boolean;
}) {
  return (
    <select aria-label="预约事项" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">不指定</option>
      {items?.map((row) => (
        <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
      ))}
      {missing(value) && <MissingSelectOption value={value} />}
    </select>
  );
}
