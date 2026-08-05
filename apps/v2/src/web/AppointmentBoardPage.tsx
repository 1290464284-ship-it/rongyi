import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const BOARD_STATUSES = [
  { key: 'BOOKED', label: '已预约' },
  { key: 'ARRIVED', label: '已到店' },
  { key: 'IN_CHAIR', label: '就诊中' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'CANCELLED', label: '已取消' },
  { key: 'NO_SHOW', label: '未到' },
] as const;

type AppointmentRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  startTime?: string | null;
  status?: string | null;
};

export function AppointmentBoardPage() {
  const { showToast } = useToast();
  const [date, setDate] = useState('');
  const query = useQuery({
    queryKey: ['appointment-board', date],
    queryFn: () => date
      ? apiRequest<Page<AppointmentRow>>(`/appointments/by-date?date=${encodeURIComponent(date)}`)
      : apiRequest<Page<AppointmentRow>>('/resources/appointments?page=1&pageSize=200'),
  });

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
          <section className="board-column" key={status.key}>
            <header>
              <span>{status.label}</span>
              <strong>{countFor(status.key)}</strong>
            </header>
            {rows
              .filter((row) => String(row.status ?? '') === status.key)
              .map((row) => (
                <article className="board-card" key={row.id}>
                  <strong>{String(row.patientId ?? '未填写患者')}</strong>
                  <span>{String(row.doctorId ?? '未分配医生')}</span>
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
