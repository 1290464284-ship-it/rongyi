import { DataTable, EmptyState, type DataTableColumn } from '../components';
import { formatMoney } from '../lib/format';
import { STATUS_LABELS, type ChargeRow } from './charge-types';

export function ChargeList({
  rows,
  onPayment,
  onRefund,
  onDelete,
}: {
  rows: ChargeRow[];
  onPayment: (id: string) => void;
  onRefund: (id: string) => void;
  onDelete: (row: ChargeRow) => void;
}) {
  const columns: DataTableColumn<ChargeRow>[] = [
    { key: 'number', label: '收费单号' },
    { key: 'totalAmount', label: '应收金额', render: (row) => formatMoney(row.totalAmount) },
    { key: 'paidAmount', label: '实收金额', render: (row) => formatMoney(row.paidAmount) },
    { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button onClick={() => onPayment(row.id)}>收款</button>
          <button className="danger" onClick={() => onRefund(row.id)}>退款</button>
          {String(row.status ?? '') === 'UNPAID' && (
            <button className="danger" onClick={() => onDelete(row)}>删除</button>
          )}
        </>
      ),
    },
  ];

  return rows.length ? (
    <DataTable columns={columns} rows={rows} keyField="id" />
  ) : (
    <EmptyState message="暂无收费单" />
  );
}
