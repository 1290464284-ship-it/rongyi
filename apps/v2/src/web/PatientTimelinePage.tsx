import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { apiRequest } from './api';
import type { Page } from './types';
import { LoadingState, PageError, SearchableSelect, type SearchableSelectRow } from './components';
import { formatMoney } from './format';

interface TimelineEvent {
  id: string;
  type: string;
  time: string;
  title: string;
  status?: string | null;
  amount?: unknown;
}

export function PatientTimelinePage() {
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get('id');
  const [patientId, setPatientId] = useState<string | null>(urlPatientId);
  const [patientRows, setPatientRows] = useState<SearchableSelectRow[]>([]);
  const derivedFromList = useRef(false);
  useEffect(() => {
    if (derivedFromList.current || patientRows.length === 0) return;
    derivedFromList.current = true;
    const first = patientRows[0];
    setPatientId((current) => current ?? (first ? String(first.id) : null));
  }, [patientRows]);
  const visits = useQuery({
    queryKey: ['visits-timeline', patientId],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/visits?page=1&pageSize=200&patientId=${encodeURIComponent(patientId ?? '')}`),
    enabled: patientId !== null,
  });
  const treatments = useQuery({
    queryKey: ['treatments-timeline', patientId],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/treatments?page=1&pageSize=200&patientId=${encodeURIComponent(patientId ?? '')}`),
    enabled: patientId !== null,
  });
  const charges = useQuery({
    queryKey: ['charges-timeline', patientId],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/charges?page=1&pageSize=200&patientId=${encodeURIComponent(patientId ?? '')}`),
    enabled: patientId !== null,
  });
  const followUps = useQuery({
    queryKey: ['followUps-timeline', patientId],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/followUps?page=1&pageSize=200&patientId=${encodeURIComponent(patientId ?? '')}`),
    enabled: patientId !== null,
  });

  if (visits.isLoading || treatments.isLoading || charges.isLoading || followUps.isLoading) {
    return <LoadingState label="患者时间线加载中..." />;
  }
  const loadError = visits.error ?? treatments.error ?? charges.error ?? followUps.error;
  if (loadError) {
    return (
      <div className="page">
        <PageError message={loadError instanceof Error ? loadError.message : String(loadError)} />
        <button onClick={() => {
          void visits.refetch();
          void treatments.refetch();
          void charges.refetch();
          void followUps.refetch();
        }}>重试</button>
      </div>
    );
  }

  const events: TimelineEvent[] = [
    ...(visits.data?.items ?? []).map((row) => ({
      id: String(row.id),
      type: '就诊',
      time: String(row.startTime ?? row.createdAt ?? ''),
      title: String(row.summary ?? '就诊记录'),
      status: row.status ? String(row.status) : null,
    })),
    ...(treatments.data?.items ?? []).map((row) => ({
      id: String(row.id),
      type: '治疗',
      time: String(row.completedDate ?? row.createdAt ?? ''),
      title: String(row.name ?? row.code ?? '治疗记录'),
      status: row.status ? String(row.status) : null,
    })),
    ...(charges.data?.items ?? []).map((row) => ({
      id: String(row.id),
      type: '收费',
      time: String(row.paidAt ?? row.createdAt ?? ''),
      title: String(row.number ?? '收费记录'),
      status: row.status ? String(row.status) : null,
      amount: row.totalAmount,
    })),
    ...(followUps.data?.items ?? []).map((row) => ({
      id: String(row.id),
      type: '随访',
      time: String(row.planDate ?? row.createdAt ?? ''),
      title: String(row.content ?? '随访记录'),
      status: row.status ? String(row.status) : null,
    })),
  ].sort((a, b) => String(b.time).localeCompare(String(a.time)) || a.type.localeCompare(b.type));

  return (
    <div className="page">
      <div className="page-head">
        <h1>患者时间线</h1>
        <label>
          患者
          <SearchableSelect
            resource="patients"
            value={patientId ?? ''}
            onChange={(id) => setPatientId(id)}
            ariaLabel="患者"
            onLoaded={(rows) => setPatientRows(rows)}
          />
        </label>
      </div>
      <div className="board-summary">
        {['就诊', '治疗', '收费', '随访'].map((type) => (
          <div className="summary-item" key={type}>
            <span>{type}</span>
            <strong>{events.filter((event) => event.type === type).length}</strong>
          </div>
        ))}
      </div>
      <div className="timeline">
        {events.map((event) => (
          <article className="timeline-item" key={`${event.type}-${event.id}`}>
            <div className="timeline-meta">
              <span>{event.type}</span>
              <time>{event.time}</time>
            </div>
            <strong>{event.title}</strong>
            <p>{event.status ?? ''}{event.amount === undefined || event.amount === null ? '' : ` · ${formatMoney(event.amount)}`}</p>
          </article>
        ))}
        {events.length === 0 && <p className="empty-board">暂无时间线记录</p>}
      </div>
    </div>
  );
}
