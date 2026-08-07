import { useState } from 'react';
import type { DataTableColumn } from '../components';
import { APPOINTMENT_STATUS_LABELS } from '../lib/labels';
import type { AppointmentRow } from './types';

/** 行内受控状态下拉：选中后立即复位为占位项，避免非受控 select 在行复用后残留旧值。 */
export function StatusTransitionSelect({ row, onTransition }: {
  row: AppointmentRow;
  onTransition: (id: string, status: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <select
      value={value}
      aria-label="变更预约状态"
      onChange={(event) => {
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
}

export function appointmentColumns({ onTransition, onEdit, onDelete }: AppointmentColumnsActions): DataTableColumn<AppointmentRow>[] {
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
          <StatusTransitionSelect row={row} onTransition={onTransition} />
          <button onClick={() => onEdit(row)}>编辑</button>
          <button className="danger" onClick={() => onDelete(row)}>删除</button>
        </>
      ),
    },
  ];
}
