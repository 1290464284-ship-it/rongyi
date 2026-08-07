import type { DataTableColumn } from '../components';
import { formatDateTime } from '../lib/format';
import { statusLabel } from './constants';
import type { PrescriptionRow } from './types';

export const prescriptionColumns: DataTableColumn<PrescriptionRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'remark', label: '备注' },
  { key: 'status', label: '状态', render: (row) => statusLabel(row.status) },
  { key: 'processedAt', label: '处理时间', render: (row) => formatDateTime(row.processedAt) },
  { key: 'chargeId', label: '划价单', render: (row) => row.chargeIdLabel ?? row.chargeId ?? '' },
  { key: 'dispenseId', label: '领药单', render: (row) => String(row.dispenseId ?? '') },
];
