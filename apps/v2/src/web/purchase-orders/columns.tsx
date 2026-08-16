import type { DataTableColumn } from '../components';
import { formatMoney } from '../lib/format';
import { PURCHASE_STATUS_LABELS } from '../lib/labels';
import { REVIEW_STATUS_LABELS } from './constants';
import type { PurchaseRow } from './types';

export const purchaseColumns: DataTableColumn<PurchaseRow>[] = [
  { key: 'number', label: '采购单号' },
  { key: 'supplierId', label: '供应商', render: (row) => row.supplierIdLabel ?? row.supplierId ?? '' },
  { key: 'totalAmount', label: '金额', render: (row) => formatMoney(row.totalAmount) },
  {
    key: 'status',
    label: '状态',
    render: (row) => {
      const value = String(row.status ?? '');
      return PURCHASE_STATUS_LABELS[value] ?? value;
    },
  },
  {
    key: 'reviewStatus',
    label: '审核状态',
    render: (row) => {
      const status = String(row.reviewStatus ?? '');
      const label = REVIEW_STATUS_LABELS[status] ?? status;
      const reason = row.rejectionReason ? String(row.rejectionReason) : '';
      return (
        <span title={status === 'REJECTED' && reason ? `驳回原因：${reason}` : label}>
          {label}
          {status === 'REJECTED' && reason ? <span className="table-muted">{reason}</span> : null}
        </span>
      );
    },
  },
];
