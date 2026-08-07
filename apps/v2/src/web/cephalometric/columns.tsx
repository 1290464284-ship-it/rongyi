import { SignedImage, type DataTableColumn } from '../components';
import { REPORT_STATUS_LABELS } from './constants';
import type { CephalometricRow } from './types';

export function cephalometricColumns(): DataTableColumn<CephalometricRow>[] {
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
      render: (row) => (
        <SignedImage path={row.imageUrl} alt="头影影像" className="imaging-thumb" fallback="无影像" />
      ),
    },
  ];
}
