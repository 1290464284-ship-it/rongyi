import { Dialog } from '../../components';
import type { ExecutionFormState } from '../../follow-ups/types';

interface FollowUpExecutionDialogProps {
  open: boolean;
  form: ExecutionFormState;
  busy: boolean;
  onFormChange: (patch: Partial<ExecutionFormState>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function FollowUpExecutionDialog({
  open,
  form,
  busy,
  onFormChange,
  onSubmit,
  onClose,
}: FollowUpExecutionDialogProps) {
  return (
    <Dialog open={open} title="执行随访" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          执行状态
          <select
            value={form.executionStatus}
            onChange={(event) => onFormChange({ executionStatus: event.target.value })}
          >
            <option value="DONE">DONE 已完成</option>
            <option value="SKIPPED">SKIPPED 已跳过</option>
          </select>
        </label>
        <label>
          患者评分（0-10）
          <input
            type="number"
            min={0}
            max={10}
            value={form.patientRating}
            onChange={(event) => onFormChange({ patientRating: event.target.value })}
          />
        </label>
        <label>
          疼痛度（0-10）
          <input
            type="number"
            min={0}
            max={10}
            value={form.painLevel}
            onChange={(event) => onFormChange({ painLevel: event.target.value })}
          />
        </label>
        <label>
          反馈
          <textarea
            value={form.feedback}
            onChange={(event) => onFormChange({ feedback: event.target.value })}
          />
        </label>
        <label>
          联系时间
          <input
            type="datetime-local"
            value={form.contactedAt}
            onChange={(event) => onFormChange({ contactedAt: event.target.value })}
          />
        </label>
        <label>
          下次随访日期
          <input
            type="date"
            value={form.nextPlanDate}
            onChange={(event) => onFormChange({ nextPlanDate: event.target.value })}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" disabled={busy}>{busy ? '提交中...' : '确认执行'}</button>
        </div>
      </form>
    </Dialog>
  );
}
