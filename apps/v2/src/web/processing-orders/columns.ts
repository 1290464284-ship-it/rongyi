import type { DataTableColumn } from '../components';
import { formatMoney } from '../format';
import { STATUS_LABELS, type ProcessingFlowStatRow, type ProcessingRow } from './types';

export const flowStatsColumns: DataTableColumn<ProcessingFlowStatRow>[] = [
  { key: 'stepName', label: '步骤' },
  { key: 'doneCount', label: '完成单数', render: (row) => String(row.doneCount ?? 0) },
  { key: 'inProgressCount', label: '进行中单数', render: (row) => String(row.inProgressCount ?? 0) },
];

export const processingColumns: DataTableColumn<ProcessingRow>[] = [
  { key: 'number', label: '加工单号' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
  { key: 'settleStatus', label: '结算状态', render: (row) => (row.settleStatus === 'SETTLED' ? '已结算' : '未结算') },
  { key: 'settledAmount', label: '结算金额', render: (row) => (row.settledAmount === null || row.settledAmount === undefined ? '—' : formatMoney(row.settledAmount)) },
];
