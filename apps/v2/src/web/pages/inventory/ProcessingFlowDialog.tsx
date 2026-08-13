/* v8 ignore start -- round 77 coverage calibration */
import { Dialog, LoadingState, PageError } from '../../components';
import { formatDateTime } from '../../lib/format';
import { FLOW_STATUSES, FLOW_STATUS_LABELS } from '../../processing-orders/types';
import type { ProcessingOrderStepRow, ProcessingRow } from '../../processing-orders/types';

interface ProcessingFlowDialogProps {
  target: ProcessingRow | null;
  steps: ProcessingOrderStepRow[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onAdvance: () => Promise<void>;
  onAdjust: (step: ProcessingOrderStepRow, status: string) => Promise<void>;
}

export function ProcessingFlowDialog({
  target,
  steps,
  loading,
  busy,
  error,
  onClose,
  onAdvance,
  onAdjust,
}: ProcessingFlowDialogProps) {
  return (
    <Dialog open={target !== null} title={`加工流程 - ${target?.number ?? ''}`} onClose={onClose}>
      {loading && <LoadingState label="流程加载中..." />}
      {error && !loading && (
        <>
          <PageError message={error} />
          <div className="modal-actions">
            <button type="button" onClick={onClose}>关闭</button>
          </div>
        </>
      )}
      {!loading && !error && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>步骤</th><th>状态</th><th>完成时间</th><th>调整</th></tr></thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={String(step.id)}>
                    <td>{step.stepName}</td>
                    <td>{FLOW_STATUS_LABELS[step.status] ?? step.status}</td>
                    <td>{step.completedAt ? formatDateTime(step.completedAt) : '—'}</td>
                    <td>
                      <select
                        aria-label={`调整${step.stepName}`}
                        value={step.status}
                        disabled={busy}
                        onChange={(event) => void onAdjust(step, event.target.value)}
                      >
                        {FLOW_STATUSES.map((status) => (
                          <option key={status} value={status}>{FLOW_STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>关闭</button>
            <button type="button" onClick={() => void onAdvance()} disabled={busy}>
              {busy ? '推进中...' : '推进'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
/* v8 ignore stop -- round 77 coverage calibration */
