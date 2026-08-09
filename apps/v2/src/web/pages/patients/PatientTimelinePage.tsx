import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { apiRequest } from '../../lib/api';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import type { Page } from '../../lib/types';
import { LoadingState, PageError, SearchableSelect, Timeline, type SearchableSelectRow } from '../../components';
import { formatMoney } from '../../lib/format';

interface TimelineEvent {
  id: string;
  type: string;
  time: string;
  title: string;
  status?: string | null;
  amount?: unknown;
}

function timelineTone(status?: string | null): 'done' | 'current' | 'pending' | undefined {
  const value = String(status ?? '');
  if (['COMPLETED', 'PAID', 'SUBMITTED', 'APPROVED'].includes(value)) return 'done';
  if (['IN_PROGRESS', 'TRIAGED', 'REGISTERED'].includes(value)) return 'current';
  return 'pending';
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
  const customFields = useQuery({
    queryKey: ['custom-fields', patientId],
    queryFn: () => apiRequest<Array<{
      id: string;
      label: string;
      fieldName: string;
      fieldType: string;
      optionsJson?: string;
      required?: boolean;
    }>>('/custom-fields?entity=patient'),
    enabled: patientId !== null,
  });
  const customFieldValues = useQuery({
    queryKey: ['custom-fields-values', patientId],
    queryFn: () => apiRequest<{ values: Record<string, string | null> }>(
      `/custom-fields/values?entity=patient&entityId=${encodeURIComponent(patientId ?? '')}`,
    ),
    enabled: patientId !== null,
  });
  const [customDraft, setCustomDraft] = useState<Record<string, string | boolean>>({});

  // H1 分区渲染：任一子查询失败只降级对应区块，不影响其余事件与患者选择器
  const timelineQueries = [visits, treatments, charges, followUps] as const;
  const timelineLoading = timelineQueries.some((query) => query.isLoading);
  const failedQueries = timelineQueries.filter((query) => query.error != null);

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
  const timelineItems = events.map((event) => ({
    title: event.title,
    time: event.time,
    description: `${event.type} · ${event.status ?? ''}${
      event.amount === undefined || event.amount === null ? '' : ` · ${formatMoney(event.amount)}`
    }`,
    tone: timelineTone(event.status),
  }));
  const { showToast } = useToast();
  const loadedCustomValues = customFieldValues.data?.values ?? {};
  function customValue(fieldId: string, fieldType: string): string | boolean {
    if (Object.prototype.hasOwnProperty.call(customDraft, fieldId)) return customDraft[fieldId] ?? '';
    const value = loadedCustomValues[fieldId];
    if (fieldType === 'BOOLEAN') return value === '1';
    return value ?? '';
  }
  async function saveCustomFields() {
    const definitions = customFields.data ?? [];
    if (definitions.length === 0 || !patientId) return;
    try {
      await apiRequest('/custom-fields/values', {
        method: 'PUT',
        body: JSON.stringify({
          entity: 'patient',
          entityId: patientId,
          values: definitions.map((field) => ({
            fieldId: field.id,
            value: customValue(field.id, field.fieldType),
          })),
        }),
      });
      showToast('自定义信息已保存', 'success');
      setCustomDraft({});
      await customFieldValues.refetch();
    } catch (error) {
      showToast(errorMessage(error, '保存自定义信息失败'), 'error');
    }
  }

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
      {timelineLoading && <LoadingState label="时间线加载中..." />}
      {failedQueries.map((query, index) => (
        <div className="query-section-error" key={`failed-${index}`}>
          <p className="error">该区块加载失败</p>
          <PageError message={query.error instanceof Error ? query.error.message : String(query.error)} />
          <button type="button" onClick={() => void query.refetch()}>重试</button>
        </div>
      ))}
      <div className="timeline">
        <Timeline items={timelineItems} />
        {events.length === 0 && !timelineLoading && failedQueries.length === 0 && <p className="empty-board">暂无时间线记录</p>}
      </div>
      {customFields.data?.length ? (
        <section className="page-section">
          <div className="page-head">
            <h2>自定义信息</h2>
            <button onClick={() => void saveCustomFields()}>保存自定义信息</button>
          </div>
          <div className="form-grid">
            {customFields.data.map((field) => {
              const value = customValue(field.id, field.fieldType);
              const options = JSON.parse(String(field.optionsJson ?? '[]')) as string[];
              return (
                <label key={field.id}>
                  {field.label}{field.required ? ' *' : ''}
                  {field.fieldType === 'BOOLEAN' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => setCustomDraft((current) => ({ ...current, [field.id]: event.target.checked }))}
                    />
                  ) : field.fieldType === 'SELECT' ? (
                    <select
                      value={String(value ?? '')}
                      onChange={(event) => setCustomDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                    >
                      <option value="">请选择</option>
                      {options.map((option) => (
                        <option key={String(option)} value={String(option)}>{String(option)}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.fieldType === 'NUMBER' ? 'number' : 'text'}
                      value={String(value ?? '')}
                      onChange={(event) => setCustomDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
