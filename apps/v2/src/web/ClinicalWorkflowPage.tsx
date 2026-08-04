import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';
type ResourcePageQuery = UseQueryResult<Page<Record<string, unknown>>, Error>;

const transitions: Record<string, Record<string, string[]>> = {
  registrations: {
    REGISTERED: ['TRIAGED', 'IN_PROGRESS', 'CANCELLED'],
    TRIAGED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  },
  visits: {
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  },
  firstExams: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['APPROVED', 'CANCELLED'],
  },
  treatments: {
    PLANNED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  },
};

const resources = ['registrations', 'visits', 'firstExams', 'treatments'] as const;

export function ClinicalWorkflowPage() {
  const [message, setMessage] = useState('');
  const registrations = useQuery({
    queryKey: ['workflow', 'registrations'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/registrations?page=1&pageSize=100'),
  });
  const visits = useQuery({
    queryKey: ['workflow', 'visits'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/visits?page=1&pageSize=100'),
  });
  const firstExams = useQuery({
    queryKey: ['workflow', 'firstExams'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/firstExams?page=1&pageSize=100'),
  });
  const treatments = useQuery({
    queryKey: ['workflow', 'treatments'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/treatments?page=1&pageSize=100'),
  });
  const queries = { registrations, visits, firstExams, treatments } as Record<typeof resources[number], ResourcePageQuery>;

  async function transition(resource: string, id: string, status: string) {
    try {
      const endpoint = resource === 'registrations'
        ? `/registrations/${id}/status`
        : resource === 'visits'
          ? `/visits/${id}/status`
          : resource === 'firstExams'
            ? `/first-exams/${id}/status`
            : `/treatments/${id}/status`;
      await apiRequest(endpoint, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMessage(`${resource} -> ${status}`);
      await queries[resource as typeof resources[number]].refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Transition failed');
    }
  }

  return (
    <div className="page">
      <h1>临床工作流</h1>
      {message && <p className="info">{message}</p>}
      {resources.map((resource) => {
        const query = queries[resource];
        const rows = query.data?.items ?? [];
        const columns: DataTableColumn<Record<string, unknown>>[] = [
          { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
          { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
          {
            key: 'actions',
            label: 'Actions',
            render: (row) => (
              <>
                {(transitions[resource]?.[String(row.status)] ?? []).map((next) => (
                  <button key={next} onClick={() => transition(resource, String(row.id), next)}>{next}</button>
                ))}
              </>
            ),
          },
        ];
        return (
          <section key={resource}>
            <h2>{resource}</h2>
            <DataTable columns={columns} rows={rows} keyField="id" emptyText="No rows" />
          </section>
        );
      })}
    </div>
  );
}
