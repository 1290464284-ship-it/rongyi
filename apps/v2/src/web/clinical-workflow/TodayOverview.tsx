import { formatDateTime } from '../format';
import { STATUS_LABELS, type TodayData } from './types';

export function TodayOverview({ data }: { data?: TodayData | null }) {
  const totals = data?.totals ?? { registrations: 0, appointments: 0, inProgressVisits: 0 };
  const registrations = data?.registrations ?? [];
  const appointments = data?.appointments ?? [];
  return (
    <section className="today-overview">
      <h2>今日概览{data?.date ? `（${data.date}）` : ''}</h2>
      <div className="today-stats">
        <div className="today-stat"><strong>{totals.registrations ?? 0}</strong><span>今日挂号</span></div>
        <div className="today-stat"><strong>{totals.appointments ?? 0}</strong><span>今日预约</span></div>
        <div className="today-stat"><strong>{totals.inProgressVisits ?? 0}</strong><span>进行中就诊</span></div>
      </div>
      <div className="today-lists">
        <div className="today-list">
          <h3>今日挂号</h3>
          {registrations.length === 0 ? (
            <div className="table-empty">今日暂无挂号</div>
          ) : (
            <ul>
              {registrations.map((row) => (
                <li key={String(row.id)}>
                  <span>{String(row.patientName ?? row.patientId ?? '')}</span>
                  <span>{String(row.doctorName ?? row.doctorId ?? '未分配医生')}</span>
                  <span>{formatDateTime(row.registeredAt)}</span>
                  <span>{STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="today-list">
          <h3>今日预约</h3>
          {appointments.length === 0 ? (
            <div className="table-empty">今日暂无预约</div>
          ) : (
            <ul>
              {appointments.map((row) => (
                <li key={String(row.id)}>
                  <span>{String(row.patientName ?? row.patientId ?? '')}</span>
                  <span>{String(row.doctorName ?? row.doctorId ?? '未分配医生')}</span>
                  <span>{formatDateTime(row.startTime)}</span>
                  <span>{STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
