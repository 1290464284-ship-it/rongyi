import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { KanbanBoard, LoadingState, PageError, type KanbanColumn } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { todayLocalDate, formatDateTime } from '../../lib/format';
import { APPOINTMENT_STATUS_LABELS } from '../../lib/labels';

// 与 AppointmentsPage 共用同一字典（M-03），文案保持"已到诊/未到诊"一致。
const BOARD_STATUSES = Object.entries(APPOINTMENT_STATUS_LABELS).map(([key, label]) => ({ key, label }));

type AppointmentRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  startTime?: string | null;
  status?: string | null;
};

/** B2：卡片时间与预约列表同口径（本地化完整时间），不再直渲 ISO 原文 */
function boardTime(value?: string | null): string {
  return formatDateTime(value);
}

export function AppointmentBoardPage() {
  const { showToast } = useToast();
  const [date, setDate] = useState(todayLocalDate());
  const [inFlightIds, setInFlightIds] = useState<ReadonlySet<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const query = useQuery({
    queryKey: ['appointment-board', date],
    queryFn: () => apiRequest<Page<AppointmentRow>>(`/appointments/by-date?date=${encodeURIComponent(date)}`),
    placeholderData: (previous) => previous,
  });
  const stale = query.isPlaceholderData;

  if (query.isLoading) return <LoadingState label="预约看板加载中..." />;
  if (query.error) {
    return (
      <div className="page">
        <PageError message={query.error instanceof Error ? query.error.message : String(query.error)} />
        <button onClick={() => { void query.refetch(); }}>重试</button>
      </div>
    );
  }

  const rows = query.data?.items ?? [];
  const countFor = (status: string): number => rows.filter((row) => String(row.status ?? '') === status).length;

  async function transition(id: string, status: string) {
    if (inFlightRef.current.has(id)) return;
    inFlightRef.current.add(id);
    setInFlightIds((current) => new Set(current).add(id));
    try {
      await apiRequest(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('预约状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    } finally {
      inFlightRef.current.delete(id);
      setInFlightIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  // A5：看板渲染统一到 KanbanBoard 组件（拖拽 + 方向键键盘移动 + role/aria 语义）
  const columns: KanbanColumn[] = BOARD_STATUSES.map((status) => ({
    id: status.key,
    title: status.label,
    cards: rows
      .filter((row) => String(row.status ?? '') === status.key)
      .map((row) => ({
        id: row.id,
        title: String(row.patientIdLabel ?? row.patientId ?? '未填写患者'),
        subtitle: `${String(row.doctorIdLabel ?? row.doctorId ?? '未分配医生')} · ${boardTime(row.startTime)}`,
        footer: (
          <select
            key={`${row.id}-${row.status}`}
            value=""
            aria-label={`${status.label}状态`}
            disabled={stale || inFlightIds.has(row.id)}
            onChange={(event) => event.target.value && transition(row.id, event.target.value)}
          >
            <option value="">变更状态</option>
            {BOARD_STATUSES.map((next) => (
              <option key={next.key} value={next.key}>{next.label}</option>
            ))}
          </select>
        ),
      })),
  }));

  function handleBoardChange(next: KanbanColumn[]) {
    /* v8 ignore next -- 看板在 stale 期间由页面 aria-busy 标记，移动回调直接忽略 */
    if (stale) return;
    const moved = next
      .flatMap((column) => column.cards.map((card) => ({ id: card.id, status: column.id })))
      .find(({ id, status }) => status !== String(rows.find((row) => row.id === id)?.status ?? ''));
    if (moved) void transition(moved.id, moved.status);
  }

  return (
    <div className="page" aria-busy={stale}>
      <div className="page-head">
        <h1>预约看板</h1>
        <input aria-label="日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <div className="board-summary">
        {BOARD_STATUSES.map((status) => (
          <div className="summary-item" key={status.key}>
            <span>{status.label}</span>
            <strong>{countFor(status.key)}</strong>
          </div>
        ))}
      </div>
      <KanbanBoard columns={columns} onChange={handleBoardChange} />
    </div>
  );
}
