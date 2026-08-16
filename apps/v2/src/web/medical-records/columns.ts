import type { DataTableColumn } from '../components';
import { CLINICAL_STATUS_LABELS } from '../lib/labels';
import { EDIT_STATUS_LABELS } from './constants';
import type { MedicalRecordRow } from './types';

export const recordColumns: DataTableColumn<MedicalRecordRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'category', label: '分类' },
  { key: 'diagnosis', label: '诊断' },
  {
    key: 'status',
    label: '状态',
    render: (row) => {
      const value = String(row.status ?? '');
      return CLINICAL_STATUS_LABELS[value] ?? value;
    },
  },
  {
    key: 'editRequestStatus',
    label: '修改状态',
    render: (row) => {
      const value = String(row.editRequestStatus ?? 'NONE');
      return EDIT_STATUS_LABELS[value] ?? value;
    },
  },
];
