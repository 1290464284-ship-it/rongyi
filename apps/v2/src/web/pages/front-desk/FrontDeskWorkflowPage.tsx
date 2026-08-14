import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { PagePager } from '../../components';
import { RegistrationBoard } from '../../clinical-workflow/RegistrationBoard';
import { ChargeDialog } from '../../clinical-workflow/ChargeDialog';
import { CreateFollowUpDialog } from '../../clinical-workflow/CreateFollowUpDialog';
import { TriageDialog } from '../../clinical-workflow/TriageDialog';
import { TriageQueuePanel } from '../../clinical-workflow/TriageQueuePanel';
import { STATUS_LABELS, type WorkbenchDialog } from '../../clinical-workflow/types';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

const registrationTransitions: Record<string, string[]> = {
  REGISTERED: ['TRIAGED', 'CANCELLED'],
  TRIAGED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
};

const WORKFLOW_PAGE_SIZE = 100;

export function FrontDeskWorkflowPage() {
  const { showToast } = useToast();
  const [activeDialog, setActiveDialog] = useState<WorkbenchDialog | null>(null);
  const [transitionKey, setTransitionKey] = useState<string | null>(null);
  // ref 同步防重：state 更新前同一次点击风暴内连续点击也能被拦下，避免并发 PATCH。
  const transitionRef = useRef(false);
  const [page, setPage] = useState(1);
  const registrations = useQuery({
    queryKey: ['front-desk', 'registrations', page],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/registrations?page=${page}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const stale = registrations.isPlaceholderData;

  async function transition(id: string, status: string) {
    if (stale) return;
    const key = `${id}:${status}`;
    if (transitionRef.current) return;
    transitionRef.current = true;
    setTransitionKey(key);
    try {
      await apiRequest(`/registrations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast(`挂号已更新为${STATUS_LABELS[status]}`, 'success');
      await registrations.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    } finally {
      transitionRef.current = false;
      setTransitionKey(null);
    }
  }

  function refreshAfterAction() {
    void registrations.refetch();
  }

  return (
    <div className="page">
      <div className="page-head"><h1>挂号分诊工作台</h1></div>
      <TriageQueuePanel onStartVisit={(id) => transition(id, 'IN_PROGRESS')} />
      <section>
        <h2>挂号</h2>
        <RegistrationBoard
          query={registrations}
          onBoardChange={(id, status) => void transition(id, status)}
          renderActions={(row) => (
            <div className="kanban-actions">
              {(registrationTransitions[String(row.status)] ?? []).map((next) => (
                <button key={next} disabled={transitionKey !== null || stale} onClick={() => void transition(String(row.id), next)}>
                  {STATUS_LABELS[next]}
                </button>
              ))}
              {row.status === 'REGISTERED' && (
                <button disabled={stale} onClick={() => setActiveDialog({ kind: 'triage', row })}>分诊</button>
              )}
              {row.status === 'TRIAGED' && <span className="triage-badge">已分诊</span>}
              <button disabled={stale} onClick={() => setActiveDialog({ kind: 'charge', row })}>划价</button>
              <button disabled={stale} onClick={() => setActiveDialog({ kind: 'followup', row })}>回访</button>
            </div>
          )}
        />
        <PagePager
          page={page}
          hasNext={page * WORKFLOW_PAGE_SIZE < (registrations.data?.total ?? 0)}
          onPageChange={setPage}
          disabled={stale}
        />
      </section>
      {activeDialog?.kind === 'charge' && !stale && (
        <ChargeDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'followup' && !stale && (
        <CreateFollowUpDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
      {activeDialog?.kind === 'triage' && !stale && (
        <TriageDialog row={activeDialog.row} onClose={() => setActiveDialog(null)} onSaved={refreshAfterAction} />
      )}
    </div>
  );
}
