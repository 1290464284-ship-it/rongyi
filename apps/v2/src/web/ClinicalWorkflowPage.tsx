import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const RESOURCE_LABELS: Record<string, string> = {
  registrations: '挂号',
  visits: '就诊',
  firstExams: '首诊',
  treatments: '治疗',
};

const STATUS_LABELS: Record<string, string> = {
  REGISTERED: '已挂号',
  TRIAGED: '已分诊',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  PLANNED: '已计划',
};

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
type ResourcePageQuery = UseQueryResult<Page<Record<string, unknown>>, Error>;

export function ClinicalWorkflowPage() {
  const { showToast } = useToast();
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

  if (Object.values(queries).some((query) => query.isLoading)) return <LoadingState />;
  const firstError = Object.values(queries).find((query) => query.error);
  if (firstError) return <PageError message={(firstError.error as Error).message} />;

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
      showToast(`${RESOURCE_LABELS[resource]}已更新为${STATUS_LABELS[status] ?? status}`, 'success');
      await queries[resource as typeof resources[number]].refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  return (
    <div className="page">
      <h1>临床工作流</h1>
      {resources.map((resource) => {
        const query = queries[resource];
        const rows = query.data?.items ?? [];
        const columns = [
          { key: 'id', label: 'ID', render: (row: Record<string, unknown>) => String(row.id).slice(0, 8) },
          {
            key: 'status',
            label: '状态',
            render: (row: Record<string, unknown>) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
          },
          {
            key: 'actions',
            label: '操作',
            render: (row: Record<string, unknown>) => (
              <>
                {(transitions[resource]?.[String(row.status)] ?? []).map((next) => (
                  <button key={next} onClick={() => transition(resource, String(row.id), next)}>
                    {STATUS_LABELS[next] ?? next}
                  </button>
                ))}
              </>
            ),
          },
        ];
        return (
          <section key={resource}>
            <h2>{RESOURCE_LABELS[resource]}</h2>
            <DataTable columns={columns} rows={rows} keyField="id" emptyText="暂无记录" />
          </section>
        );
      })}
    </div>
  );
}
