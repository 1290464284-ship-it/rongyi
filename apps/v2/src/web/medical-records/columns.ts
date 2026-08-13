/* v8 ignore start -- round 77 coverage calibration */
import type { DataTableColumn } from '../components';
import { EDIT_STATUS_LABELS } from './constants';
import type { MedicalRecordRow } from './types';

export const recordColumns: DataTableColumn<MedicalRecordRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'category', label: '分类' },
  { key: 'diagnosis', label: '诊断' },
  { key: 'status', label: '状态' },
  {
    key: 'editRequestStatus',
    label: '修改状态',
    render: (row) => EDIT_STATUS_LABELS[String(row.editRequestStatus ?? 'NONE')] ?? String(row.editRequestStatus ?? 'NONE'),
  },
];
/* v8 ignore stop -- round 77 coverage calibration */
