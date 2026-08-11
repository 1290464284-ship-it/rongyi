import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { KanbanBoard, QuerySection } from '../components';
import type { Page } from '../lib/types';
import { STATUS_LABELS } from './types';

interface RegistrationBoardProps {
  query: UseQueryResult<Page<Record<string, unknown>>, Error>;
  renderActions: (row: Record<string, unknown>) => ReactNode;
  onBoardChange: (id: string, nextStatus: 'REGISTERED' | 'IN_PROGRESS' | 'COMPLETED') => void;
  filterRows?: (row: Record<string, unknown>) => boolean;
  emptyText?: string;
}

/** 挂号看板：候诊/就诊中/已完成三列，供前台与医生工作台复用。 */
export function RegistrationBoard({
  query,
  renderActions,
  onBoardChange,
  filterRows,
  emptyText = '暂无记录',
}: RegistrationBoardProps) {
  const statusOf = (row: Record<string, unknown>) => String(row.status ?? '');
  const card = (row: Record<string, unknown>) => ({
    id: String(row.id),
    title: String(row.patientIdLabel ?? row.patientId ?? row.id),
    subtitle: STATUS_LABELS[statusOf(row)] ?? statusOf(row),
    footer: renderActions(row),
  });
  const buildColumns = (rows: Array<Record<string, unknown>>) => [
    {
      id: 'waiting',
      title: '候诊',
      cards: rows.filter((row) => !['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(statusOf(row))).map(card),
    },
    {
      id: 'in-progress',
      title: '就诊中',
      cards: rows.filter((row) => statusOf(row) === 'IN_PROGRESS').map(card),
    },
    {
      id: 'done',
      title: '已完成',
      cards: rows.filter((row) => ['COMPLETED', 'CANCELLED'].includes(statusOf(row))).map(card),
    },
  ];

  return (
    <QuerySection
      query={query}
      render={(data) => {
        const rows = (data?.items ?? []).filter((row) => (filterRows ? filterRows(row) : true));
        if (rows.length === 0) return <div className="table-empty">{emptyText}</div>;
        const boardColumns = buildColumns(rows);
        const beforeMap = new Map(
          boardColumns.map((column) => [column.id, new Set(column.cards.map((entry) => entry.id))]),
        );
        return (
          <KanbanBoard
            columns={boardColumns}
            onChange={(next) => {
              for (const column of next) {
                for (const entry of column.cards) {
                  if (!beforeMap.get(column.id)?.has(entry.id)) {
                    const nextStatus = column.id === 'in-progress'
                      ? 'IN_PROGRESS'
                      : column.id === 'done'
                        ? 'COMPLETED'
                        : 'REGISTERED';
                    onBoardChange(entry.id, nextStatus);
                    return;
                  }
                }
              }
            }}
          />
        );
      }}
    />
  );
}
