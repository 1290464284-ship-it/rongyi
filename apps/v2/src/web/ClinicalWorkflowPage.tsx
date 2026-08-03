import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from './api';

interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }
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
  const queries = Object.fromEntries(
    resources.map((resource) => [
      resource,
      useQuery({
        queryKey: ['workflow', resource],
        queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/${resource}?page=1&pageSize=100`),
      }),
    ]),
  ) as Record<typeof resources[number], ResourcePageQuery>;

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
        return (
          <section key={resource}>
            <h2>{resource}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.id).slice(0, 8)}</td>
                      <td>{String(row.status ?? '')}</td>
                      <td>
                        {(transitions[resource]?.[String(row.status)] ?? []).map((next) => (
                          <button key={next} onClick={() => transition(resource, String(row.id), next)}>{next}</button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
