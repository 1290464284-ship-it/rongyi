import { useState, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DataTable, KanbanBoard, QuerySection } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { STATUS_LABELS, type TodayData, type WorkbenchDialog } from '../../clinical-workflow/types';
import { TodayOverview } from '../../clinical-workflow/TodayOverview';
import { ChargeDialog } from '../../clinical-workflow/ChargeDialog';
import { RecordDialog } from '../../clinical-workflow/RecordDialog';
import { FollowUpDialog } from '../../clinical-workflow/FollowUpDialog';
import { TriageDialog } from '../../clinical-workflow/TriageDialog';
import { TriageQueuePanel } from '../../clinical-workflow/TriageQueuePanel';

const RESOURCE_LABELS: Record<string, string> = {
  registrations: '挂号',
  visits: '就诊',
  firstExams: '首诊',
  treatments: '治疗',
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
  const today = useQuery({
    queryKey: ['workbench', 'today'],
    queryFn: () => apiRequest<TodayData>('/workbench/today'),
  });
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
  const [activeDialog, setActiveDialog] = useState<WorkbenchDialog | null>(null);

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

  function refreshAfterAction() {
    void today.refetch();
    void queries.registrations.refetch();
  }

  function registrationKanbanColumns(
    rows: Array<Record<string, unknown>>,
    footerForRow: (row: Record<string, unknown>) => ReactNode,
  ) {
    const statusOf = (row: Record<string, unknown>) => String(row.status ?? '');
    const card = (row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.patientIdLabel ?? row.patientId ?? row.id),
      subtitle: STATUS_LABELS[statusOf(row)] ?? statusOf(row),
      footer: footerForRow(row),
    });
    return [
      {
        id: 'waiting',
        title: '候诊',
        cards: rows.filter((row) => !['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(statusOf(row))).map(card),
      },
      {
        id: 'in-progress',
        title: '就诊中',
        cards: rows.filter((row) => statusOf(row) === 'IN_PROGRESS').map(card),
      },
      {
        id: 'done',
        title: '已完成',
        cards: rows.filter((row) => ['COMPLETED', 'CANCELLED'].includes(statusOf(row))).map(card),
      },
    ];
  }

  return (
    <div className="page">
      <div className="page-head"><h1>就诊工作台</h1></div>
      <QuerySection query={today} render={(data) => <TodayOverview data={data} />} />
      <TriageQueuePanel onStartVisit={(id) => transition('registrations', id, 'IN_PROGRESS')} />
      {resources.map((resource) => {
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
                  <button key={next} onClick={() => transition(resource, String(row.id), next)}>
                    {STATUS_LABELS[next] ?? next}
                  </button>
                ))}
                {resource === 'registrations' && (
                  <>
                    {row.status === 'REGISTERED' && (
                      <button onClick={() => setActiveDialog({ kind: 'triage', row })}>分诊</button>
                    )}
                    {row.status === 'TRIAGED' && <span className="triage-badge">已分诊</span>}
                    <button onClick={() => setActiveDialog({ kind: 'charge', row })}>划价</button>
                    <button onClick={() => setActiveDialog({ kind: 'record', row })}>病历</button>
                    <button onClick={() => setActiveDialog({ kind: 'followup', row })}>回访</button>
                  </>
                )}
              </>
            ),
          },
        ];
        return (
          <section key={resource}>
            <h2>{RESOURCE_LABELS[resource]}</h2>
            {resource === 'registrations' ? (
              <QuerySection
                query={query}
                render={(data) => {
                  const rows = data?.items ?? [];
                  if (rows.length === 0) return <div className="table-empty">暂无记录</div>;
                  const boardColumns = registrationKanbanColumns(rows, (row) => (
                    <div className="kanban-actions">
                      {(transitions.registrations?.[String(row.status)] ?? []).map((next) => (
                        <button key={next} onClick={() => transition('registrations', String(row.id), next)}>
                          {STATUS_LABELS[next] ?? next}
                        </button>
                      ))}
                      {row.status === 'REGISTERED' && (
                        <button onClick={() => setActiveDialog({ kind: 'triage', row })}>分诊</button>
                      )}
                      {row.status === 'TRIAGED' && <span className="triage-badge">已分诊</span>}
                      <button onClick={() => setActiveDialog({ kind: 'charge', row })}>划价</button>
                      <button onClick={() => setActiveDialog({ kind: 'record', row })}>病历</button>
                      <button onClick={() => setActiveDialog({ kind: 'followup', row })}>回访</button>
                    </div>
                  ));
                  const beforeMap = new Map(
                    boardColumns.map((column) => [column.id, new Set(column.cards.map((card) => card.id))]),
                  );
                  return (
                    <KanbanBoard
                      columns={boardColumns}
                      onChange={(next) => {
                        for (const column of next) {
                          for (const card of column.cards) {
                            if (!beforeMap.get(column.id)?.has(card.id)) {
                              const nextStatus = column.id === 'in-progress'
                                ? 'IN_PROGRESS'
                                : column.id === 'done'
                                  ? 'COMPLETED'
                                  : 'REGISTERED';
                              void transition('registrations', card.id, nextStatus);
                              return;
                            }
                          }
                        }
                      }}
                    />
                  );
                }}
              />
            ) : (
              <QuerySection
                query={query}
                render={(data) => <DataTable columns={columns} rows={data?.items ?? []} keyField="id" emptyText="暂无记录" />}
              />
            )}
          </section>
        );
      })}
      {activeDialog?.kind === 'charge' && (
        <ChargeDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'record' && (
        <RecordDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'followup' && (
        <FollowUpDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'triage' && (
        <TriageDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
    </div>
  );
}
