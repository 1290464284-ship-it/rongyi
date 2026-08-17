import type { DataTableColumn } from '../../components';
import { formatMoney } from '../../lib/format';
import type { RuleRow, StatementRow } from './commission-types';

export function ruleColumns(handlers: { onEdit: (row: RuleRow) => void; onDelete: (row: RuleRow) => void }): DataTableColumn<RuleRow>[] {
  const { onEdit, onDelete } = handlers;
  return [
    { key: 'name', label: '规则名称' },
    {
      key: 'scope',
      label: '适用范围',
      render: (row) => [
        row.category ? `分类 ${row.category}` : '全部分类',
        row.costType ? (row.costType === 'SERVICE' ? '技术服务' : '材料耗材') : '',
        row.doctorId ? '指定医生' : '默认',
      ].filter(Boolean).join(' / '),
    },
    {
      key: 'rate',
      label: '提成',
      render: (row) => (
        row.rateType === 'PERCENT'
          ? `${Math.round(Number(row.rate ?? 0) / 100)}%`
          : `${formatMoney(row.rate)}/单`
      ),
    },
    { key: 'enabled', label: '状态', render: (row) => (Number(row.enabled) === 1 ? '启用' : '停用') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button type="button" onClick={() => onEdit(row)}>编辑</button>
          <button type="button" className="danger" onClick={() => onDelete(row)}>删除</button>
        </>
      ),
    },
  ];
}

export const statementColumns: DataTableColumn<StatementRow>[] = [
  { key: 'doctorName', label: '医生', render: (row) => String(row.doctorName ?? row.doctorId ?? '') },
  { key: 'totalCharged', label: '计提升成金额', render: (row) => formatMoney(row.totalCharged) },
  { key: 'totalCommission', label: '提成金额', render: (row) => formatMoney(row.totalCommission) },
  { key: 'calculatedAt', label: '计算时间' },
  {
    key: 'breakdown',
    label: '明细',
    render: (row) => (
      <span>
        {row.breakdown.map((entry) => `${entry.category}(${formatMoney(entry.commission)})`).join('，') || '—'}
      </span>
    ),
  },
];
