import { useRef, useState, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DataTable, PagePager, QuerySection } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { STATUS_LABELS, type TodayData, type WorkbenchDialog } from '../../clinical-workflow/types';
import { TodayOverview } from '../../clinical-workflow/TodayOverview';
import { RecordDialog } from '../../clinical-workflow/RecordDialog';
import { CreateFollowUpDialog } from '../../clinical-workflow/CreateFollowUpDialog';
import { RegistrationBoard } from '../../clinical-workflow/RegistrationBoard';

const RESOURCE_LABELS: Record<string, string> = {
  registrations: '候诊',
  visits: '就诊',
  firstExams: '首诊',
  treatments: '治疗',
};

const WORKFLOW_PAGE_SIZE = 100;

const transitions: Record<string, Record<string, string[]>> = {
  registrations: {
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
  const [resourcePage, setResourcePage] = useState<Record<typeof resources[number], number>>({
    registrations: 1,
    visits: 1,
    firstExams: 1,
    treatments: 1,
  });
  const today = useQuery({
    queryKey: ['workbench', 'today'],
    queryFn: () => apiRequest<TodayData>('/workbench/today'),
  });
  const registrations = useQuery({
    queryKey: ['workflow', 'registrations', resourcePage.registrations],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/registrations?page=${resourcePage.registrations}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const visits = useQuery({
    queryKey: ['workflow', 'visits', resourcePage.visits],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/visits?page=${resourcePage.visits}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const firstExams = useQuery({
    queryKey: ['workflow', 'firstExams', resourcePage.firstExams],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/firstExams?page=${resourcePage.firstExams}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const treatments = useQuery({
    queryKey: ['workflow', 'treatments', resourcePage.treatments],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/treatments?page=${resourcePage.treatments}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const queries = { registrations, visits, firstExams, treatments } as Record<typeof resources[number], ResourcePageQuery>;
  const [activeDialog, setActiveDialog] = useState<WorkbenchDialog | null>(null);
  const [transitionKey, setTransitionKey] = useState<string | null>(null);
  // ref 同步防重：state 更新前同一次点击风暴内连续点击也能被拦下，避免并发 PATCH。
  const transitionRef = useRef(false);

  async function transition(resource: string, id: string, status: string) {
    const key = `${resource}:${id}:${status}`;
    if (transitionRef.current) return;
    transitionRef.current = true;
    setTransitionKey(key);
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
      if (resource === 'registrations' && (status === 'IN_PROGRESS' || status === 'COMPLETED')) {
        void queries.visits.refetch();
        void today.refetch();
      }
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    } finally {
      transitionRef.current = false;
      setTransitionKey(null);
    }
  }

  function refreshAfterAction() {
    void today.refetch();
    void queries.registrations.refetch();
    void queries.visits.refetch();
  }

  function registrationActions(row: Record<string, unknown>): ReactNode {
    return (
      <div className="kanban-actions">
        {(transitions.registrations?.[String(row.status)] ?? []).map((next) => (
          <button key={next} disabled={transitionKey !== null} onClick={() => transition('registrations', String(row.id), next)}>
            {STATUS_LABELS[next] ?? next}
          </button>
        ))}
        {row.status === 'TRIAGED' && <span className="triage-badge">已分诊</span>}
        <button onClick={() => setActiveDialog({ kind: 'record', row })}>病历</button>
        <button onClick={() => setActiveDialog({ kind: 'followup', row })}>回访</button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head"><h1>就诊工作台</h1></div>
      <QuerySection query={today} render={(data) => <TodayOverview data={data} />} />
      <section>
        <h2>候诊</h2>
        <RegistrationBoard
          query={registrations}
          onBoardChange={(id, status) => void transition('registrations', id, status)}
          renderActions={registrationActions}
          filterRows={(row) => String(row.status ?? '') !== 'REGISTERED'}
          emptyText="暂无已分诊患者"
        />
        <PagePager
          page={resourcePage.registrations}
          hasNext={resourcePage.registrations * WORKFLOW_PAGE_SIZE < (registrations.data?.total ?? 0)}
          onPageChange={(page) => setResourcePage((current) => ({ ...current, registrations: page }))}
        />
      </section>
      {resources.slice(1).map((resource) => {
        const query = queries[resource];
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
                  <button key={next} disabled={transitionKey !== null} onClick={() => transition(resource, String(row.id), next)}>
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
            <QuerySection
              query={query}
              render={(data) => <DataTable columns={columns} rows={data?.items ?? []} keyField="id" emptyText="暂无记录" />}
            />
            <PagePager
              page={resourcePage[resource]}
              hasNext={resourcePage[resource] * WORKFLOW_PAGE_SIZE < (query.data?.total ?? 0)}
              onPageChange={(page) => setResourcePage((current) => ({ ...current, [resource]: page }))}
            />
          </section>
        );
      })}
      {activeDialog?.kind === 'record' && (
        <RecordDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'followup' && (
        <CreateFollowUpDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
    </div>
  );
}
