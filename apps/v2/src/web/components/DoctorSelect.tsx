import { useDoctors } from '../hooks/use-doctors';
import { MissingSelectOption } from './list-controls';

/**
 * 医生受控下拉：统一 useDoctors 数据源 + option 循环 + MissingSelectOption + 加载失败行内重试。
 * 传 `label` 时输出 `<label>文字<select/></label>`（错误块保持为 label 的兄弟节点）；
 * 传 `ariaLabel` 时输出裸 `<select aria-label="...">`（用于 inline-form 场景）。
 */
export function DoctorSelect({
  value,
  onChange,
  required = false,
  disabled = false,
  ariaLabel,
  label,
  placeholder = '选择医生',
}: {
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  label?: string;
  placeholder?: string;
}) {
  const doctors = useDoctors();
  const rows = doctors.data ?? [];
  const missing = value !== '' && !doctors.isLoading && !rows.some((row) => String(row.id) === value);

  const select = (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      disabled={disabled || doctors.isError}
    >
      <option value="">{placeholder}</option>
      {missing && <MissingSelectOption value={value} />}
      {rows.map((row) => (
        <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
      ))}
    </select>
  );

  return (
    <>
      {doctors.isError && (
        <div className="query-section-error">
          <p className="error">医生列表加载失败</p>
          <button type="button" className="btn-secondary" onClick={() => void doctors.refetch()}>重试</button>
        </div>
      )}
      {label ? <label>{label}{select}</label> : select}
    </>
  );
}
