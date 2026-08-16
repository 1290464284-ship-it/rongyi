import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Dialog, SearchableSelect } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import type { NarcoticForm } from './types';

/** 编辑麻药登记弹窗：从列表行预填全部可编辑字段，提交 PATCH /narcotic-registry/:id。 */
export function NarcoticEditDialog({
  record,
  onClose,
  onDone,
}: {
  record: Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<NarcoticForm>(() => ({
    recordDate: String(record.recordDate ?? ''),
    itemId: String(record.itemId ?? ''),
    batchNo: String(record.batchNo ?? ''),
    quantity: String(Number(record.quantity ?? 0)),
    usage: String(record.usage ?? ''),
    balanceBefore: record.balanceBefore === null || record.balanceBefore === undefined ? '' : String(record.balanceBefore),
    balanceAfter: record.balanceAfter === null || record.balanceAfter === undefined ? '' : String(record.balanceAfter),
    remark: String(record.remark ?? ''),
  }));
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const quantity = Number(form.quantity);
    if (!form.recordDate || !form.itemId || !Number.isSafeInteger(quantity) || quantity < 0) {
      showToast('请填写登记日期、麻药物品和有效的麻药数量', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/narcotic-registry/${String(record.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          recordDate: form.recordDate,
          itemId: form.itemId,
          batchNo: form.batchNo.trim() || undefined,
          quantity,
          usage: form.usage.trim() || undefined,
          balanceBefore: form.balanceBefore.trim() === '' ? undefined : Number(form.balanceBefore),
          balanceAfter: form.balanceAfter.trim() === '' ? undefined : Number(form.balanceAfter),
          remark: form.remark.trim() || undefined,
        }),
      });
      showToast('麻药登记已更新', 'success');
      onClose();
      onDone();
    } catch (error) {
      showToast(errorMessage(error, '更新麻药登记失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="编辑麻药登记" onClose={onClose}>
      <form className="inline-form" onSubmit={submit}>
        <label>
          登记日期
          <input
            aria-label="编辑登记日期"
            type="date"
            value={form.recordDate}
            onChange={(event) => setForm((current) => ({ ...current, recordDate: event.target.value }))}
          />
        </label>
        <label>
          麻药物品
          <SearchableSelect
            resource="inventoryItems"
            value={form.itemId}
            onChange={(id) => setForm((current) => ({ ...current, itemId: id }))}
            ariaLabel="编辑麻药物品"
            placeholder="选择麻药物品"
          />
        </label>
        <label>
          批号
          <input
            aria-label="编辑批号"
            value={form.batchNo}
            onChange={(event) => setForm((current) => ({ ...current, batchNo: event.target.value }))}
          />
        </label>
        <label>
          麻药数量
          <input
            aria-label="编辑麻药数量"
            type="number"
            min="0"
            value={form.quantity}
            onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
          />
        </label>
        <label>
          用途
          <input
            aria-label="编辑用途"
            value={form.usage}
            onChange={(event) => setForm((current) => ({ ...current, usage: event.target.value }))}
          />
        </label>
        <label>
          余量前
          <input
            aria-label="编辑余量前"
            type="number"
            min="0"
            value={form.balanceBefore}
            onChange={(event) => setForm((current) => ({ ...current, balanceBefore: event.target.value }))}
          />
        </label>
        <label>
          余量后
          <input
            aria-label="编辑余量后"
            type="number"
            min="0"
            value={form.balanceAfter}
            onChange={(event) => setForm((current) => ({ ...current, balanceAfter: event.target.value }))}
          />
        </label>
        <label>
          备注
          <textarea
            aria-label="编辑备注"
            value={form.remark}
            onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>{busy ? '保存中...' : '保存修改'}</button>
        </div>
      </form>
    </Dialog>
  );
}
