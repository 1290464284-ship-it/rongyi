import type { DataTableColumn } from '../components';
import { REPORT_STATUS_LABELS } from './constants';
import type { CephalometricRow } from './types';

export function cephalometricColumns(apiOrigin: string): DataTableColumn<CephalometricRow>[] {
  return [
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
    { key: 'status', label: '状态' },
    {
      key: 'reportStatus',
      label: '报告状态',
      render: (row) => REPORT_STATUS_LABELS[String(row.reportStatus ?? '')] ?? String(row.reportStatus ?? ''),
    },
    {
      key: 'preview',
      label: '影像',
      render: (row) => (row.imageUrl ? <img className="imaging-thumb" src={`${apiOrigin}${row.imageUrl}`} alt="头影影像" /> : '无影像'),
    },
  ];
}
