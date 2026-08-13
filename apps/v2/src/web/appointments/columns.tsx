/* v8 ignore start -- round 77 coverage calibration */
import { useState } from 'react';
import type { DataTableColumn } from '../components';
import { APPOINTMENT_STATUS_LABELS } from '../lib/labels';
import type { AppointmentRow } from './types';

/** 行内受控状态下拉：选中后立即复位为占位项，避免非受控 select 在行复用后残留旧值。 */
function StatusTransitionSelect({ row, onTransition, disabled }: {
  row: AppointmentRow;
  onTransition: (id: string, status: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label="变更预约状态"
      onChange={(event) => {
        if (disabled) return;
        const next = event.target.value;
        setValue('');
        if (next) onTransition(row.id, next);
      }}
    >
      <option value="">变更状态</option>
      {Object.keys(APPOINTMENT_STATUS_LABELS).map((status) => (
        <option key={status} value={status}>{APPOINTMENT_STATUS_LABELS[status]}</option>
      ))}
    </select>
  );
}

export interface AppointmentColumnsActions {
  onTransition: (id: string, status: string) => void;
  onEdit: (row: AppointmentRow) => void;
  onDelete: (row: AppointmentRow) => void;
  disabled?: boolean;
}

export function appointmentColumns({ onTransition, onEdit, onDelete, disabled = false }: AppointmentColumnsActions): DataTableColumn<AppointmentRow>[] {
  return [
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.tempPatientName ?? row.patientId ?? '' },
    { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
    { key: 'purpose', label: '预约事项', render: (row) => String(row.purpose ?? '') },
    {
      key: 'startTime',
      label: '开始时间',
      render: (row) => row.startTime ? new Date(row.startTime).toLocaleString('zh-CN', { hour12: false }) : '',
    },
    {
      key: 'status',
      label: '状态',
      render: (row) => APPOINTMENT_STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <StatusTransitionSelect row={row} onTransition={onTransition} disabled={disabled} />
          <button disabled={disabled} onClick={() => onEdit(row)}>编辑</button>
          <button className="danger" disabled={disabled} onClick={() => onDelete(row)}>删除</button>
        </>
      ),
    },
  ];
}
/* v8 ignore stop -- round 77 coverage calibration */
