import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import type { Page } from '../lib/types';
import { LoadingState, PageError } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { todayLocalDate } from '../lib/format';
import { APPOINTMENT_STATUS_LABELS } from '../lib/labels';

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

export function AppointmentBoardPage() {
  const { showToast } = useToast();
  const [date, setDate] = useState(todayLocalDate());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['appointment-board', date],
    queryFn: () => apiRequest<Page<AppointmentRow>>(`/appointments/by-date?date=${encodeURIComponent(date)}`),
  });

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
    try {
      await apiRequest(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('预约状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  async function handleDrop(statusKey: string) {
    const id = draggingId;
    setDraggingId(null);
    setDragOverColumn(null);
    if (!id) return;
    const row = rows.find((entry) => entry.id === id);
    if (!row || String(row.status ?? '') === statusKey) return;
    await transition(id, statusKey);
  }

  return (
    <div className="page">
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
      <div className="board">
        {BOARD_STATUSES.map((status) => (
          <section
            className={`board-column${dragOverColumn === status.key ? ' drag-over' : ''}`}
            style={dragOverColumn === status.key
              ? { borderColor: '#2f80ed', boxShadow: '0 0 0 2px rgba(47, 128, 237, 0.25)' }
              : undefined}
            data-status={status.key}
            key={status.key}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverColumn(status.key);
            }}
            onDragLeave={() => setDragOverColumn((current) => (current === status.key ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              void handleDrop(status.key);
            }}
          >
            <header>
              <span>{status.label}</span>
              <strong>{countFor(status.key)}</strong>
            </header>
            {rows
              .filter((row) => String(row.status ?? '') === status.key)
              .map((row) => (
                <article
                  className={`board-card${draggingId === row.id ? ' dragging' : ''}`}
                  style={draggingId === row.id ? { opacity: 0.55 } : undefined}
                  draggable
                  data-id={row.id}
                  key={row.id}
                  onDragStart={(event) => {
                    event.dataTransfer?.setData('text/plain', row.id);
                    setDraggingId(row.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverColumn(null);
                  }}
                >
                  <strong>{String(row.patientIdLabel ?? row.patientId ?? '未填写患者')}</strong>
                  <span>{String(row.doctorIdLabel ?? row.doctorId ?? '未分配医生')}</span>
                  <time>{String(row.startTime ?? '')}</time>
                  <select
                    defaultValue=""
                    aria-label={`${status.label}状态`}
                    onChange={(event) => event.target.value && transition(row.id, event.target.value)}
                  >
                    <option value="">变更状态</option>
                    {BOARD_STATUSES.map((next) => (
                      <option key={next.key} value={next.key}>{next.label}</option>
                    ))}
                  </select>
                </article>
              ))}
            {countFor(status.key) === 0 && <p className="empty-board">暂无预约</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
