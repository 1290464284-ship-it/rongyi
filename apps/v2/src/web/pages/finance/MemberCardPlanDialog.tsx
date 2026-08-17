import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api';
import { Dialog } from '../../components';
import { toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import type { ToastKind } from '../../lib/toast-context';

interface MemberCardPlanDialogProps {
  open: boolean;
  cardId: string | null;
  onSaved: () => void;
  onClose: () => void;
  showToast: (message: string, kind?: ToastKind) => void;
}

export function MemberCardPlanDialog({ open, cardId, onSaved, onClose, showToast }: MemberCardPlanDialogProps) {
  const [planForm, setPlanForm] = useState({
    discountRate: '',
    maxDiscountAmount: '',
    roundingMode: 'FLOOR',
    annualDiscountLimit: '',
    specialDiscountsJson: '',
  });
  const { busy: planBusy, run: runPlanSave } = useAsyncAction();

  async function savePlan(event: FormEvent) {
    event.preventDefault();
    if (!cardId || planBusy) return;
    let specialDiscountsJson: unknown = null;
    const rawJson = planForm.specialDiscountsJson.trim();
    if (rawJson) {
      try {
        specialDiscountsJson = JSON.parse(rawJson);
      } catch {
        showToast('特殊项目折扣 JSON 格式错误', 'error');
        return;
      }
    }
    const targetCardId = cardId;
    await runPlanSave(async () => {
      try {
        await apiRequest(`/member-cards/${targetCardId}/discount-plan`, {
          method: 'PUT',
          body: JSON.stringify({
            discountRate: planForm.discountRate === '' ? null : Number(planForm.discountRate),
            maxDiscountAmount: planForm.maxDiscountAmount === '' ? null : toCents(planForm.maxDiscountAmount),
            roundingMode: planForm.roundingMode,
            annualDiscountLimit: planForm.annualDiscountLimit === '' ? null : toCents(planForm.annualDiscountLimit),
            specialDiscountsJson,
          }),
        });
        showToast('折扣方案已保存', 'success');
        onClose();
        onSaved();
      } catch (error) {
        showToast(errorMessage(error, '保存折扣方案失败'), 'error');
      }
    });
  }

  return (
    <Dialog open={open} title="折扣方案" onClose={onClose}>
      <form onSubmit={savePlan}>
        <label>
          折扣率(%)
          <input type="number" min="0" max="100" value={planForm.discountRate} onChange={(event) => setPlanForm({ ...planForm, discountRate: event.target.value })} />
        </label>
        <label>
          单次折扣上限(元)
          <input type="number" min="0" value={planForm.maxDiscountAmount} onChange={(event) => setPlanForm({ ...planForm, maxDiscountAmount: event.target.value })} />
        </label>
        <label>
          取整方式
          <select value={planForm.roundingMode} onChange={(event) => setPlanForm({ ...planForm, roundingMode: event.target.value })}>
            <option value="NONE">不取整</option>
            <option value="FLOOR">抹零向下</option>
            <option value="ROUND">四舍五入</option>
          </select>
        </label>
        <label>
          年度折扣上限(元)
          <input type="number" min="0" value={planForm.annualDiscountLimit} onChange={(event) => setPlanForm({ ...planForm, annualDiscountLimit: event.target.value })} />
        </label>
        <label>
          特殊项目折扣
          <textarea rows={3} value={planForm.specialDiscountsJson} onChange={(event) => setPlanForm({ ...planForm, specialDiscountsJson: event.target.value })} placeholder='[{"name":"隐形矫正","category":"ORTHODONTIC","rate":90}]' />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={planBusy}>保存</button>
        </div>
      </form>
    </Dialog>
  );
}
