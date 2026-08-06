import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { formatDateTime } from '../format';
import type { Page } from '../types';
import { STATUS_LABELS } from './types';

export function TriageQueuePanel({ onStartVisit }: { onStartVisit: (id: string) => void | Promise<void> }) {
  const [departmentId, setDepartmentId] = useState('');
  const departments = useQuery({
    queryKey: ['workflow', 'departments'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/departments?page=1&pageSize=100'),
  });
  const queue = useQuery({
    queryKey: ['triage', 'queue', departmentId],
    queryFn: () =>
      apiRequest<Page<Record<string, unknown>>>(
        departmentId ? `/triage/queue?departmentId=${encodeURIComponent(departmentId)}` : '/triage/queue',
      ),
  });
  if (queue.isLoading || queue.error) return null;
  const items = queue.data?.items ?? [];

  async function startVisit(row: Record<string, unknown>) {
    await onStartVisit(String(row.id ?? ''));
    void queue.refetch();
  }

  return (
    <section className="triage-queue">
      <h2>分诊队列</h2>
      <label>
        科室筛选
        <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
          <option value="">全部科室</option>
          {departments.data?.items?.map((department) => (
            <option key={String(department.id)} value={String(department.id)}>
              {String(department.name ?? department.id)}
            </option>
          ))}
        </select>
      </label>
      {items.length === 0 ? (
        <div className="table-empty">暂无分诊队列</div>
      ) : (
        <ul>
          {items.map((row) => (
            <li key={String(row.id)}>
              <span>{String(row.patientName ?? row.patientId ?? '')}</span>
              <span>{String(row.departmentName ?? row.departmentId ?? '未分诊')}</span>
              <span>{String(row.doctorName ?? row.doctorId ?? '未分配医生')}</span>
              <span>{formatDateTime(row.registeredAt)}</span>
              <span>{row.triagedAt ? formatDateTime(row.triagedAt) : '未分诊'}</span>
              <span>{STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '')}</span>
              {row.status === 'REGISTERED' && (
                <button onClick={() => startVisit(row)}>开始就诊</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
