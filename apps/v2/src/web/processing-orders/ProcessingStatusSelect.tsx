import { useState } from 'react';
import { STATUS_LABELS } from './types';

/** 行内受控状态下拉：选中后立即复位为占位项，避免非受控 select 在行复用后残留旧值。 */
export function ProcessingStatusSelect({ rowId, onTransition }: {
  rowId: string;
  onTransition: (id: string, status: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <select
      value={value}
      aria-label="变更加工状态"
      onChange={(event) => {
        const next = event.target.value;
        setValue('');
        if (next) onTransition(rowId, next);
      }}
    >
      <option value="">变更状态</option>
      {Object.entries(STATUS_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}
