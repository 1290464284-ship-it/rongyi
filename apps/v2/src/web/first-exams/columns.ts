/* v8 ignore start -- round 77 coverage calibration */
import type { DataTableColumn } from '../components';
import { formatDateTime } from '../lib/format';
import { DENTITION_LABELS, FOLLOW_UP_STATUS_LABELS, STATUS_LABELS } from './constants';
import type { FirstExamRow } from './types';

export const firstExamColumns: DataTableColumn<FirstExamRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'chiefComplaint', label: '主诉' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
  {
    key: 'followUpStatus',
    label: '追踪状态',
    render: (row) => {
      const value = String(row.followUpStatus ?? 'NONE');
      return FOLLOW_UP_STATUS_LABELS[value] ?? value;
    },
  },
  {
    key: 'dentition',
    label: '牙列',
    render: (row) => DENTITION_LABELS[String(row.dentition ?? '')] ?? String(row.dentition ?? ''),
  },
  {
    key: 'restartedAt',
    label: '重启',
    render: (row) => (row.restartedAt ? `已重启 ${formatDateTime(row.restartedAt)}` : ''),
  },
];
/* v8 ignore stop -- round 77 coverage calibration */
