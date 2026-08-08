import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import {
  ConfirmDialog,
  DataTable,
  Dialog,
  LoadingState,
  PageError,
  SearchableSelect,
  type DataTableColumn,
} from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import type { Page } from '../lib/types';
import { emptyNarcoticForm, type NarcoticForm } from './types';

/** 麻药登记面板：登记表单与登记记录列表，narcotics 查询、表单状态与删除/编辑逻辑均在本面板内部。 */
export function DispenseNarcoticPanel() {
  const { showToast } = useToast();
  const [narcoticForm, setNarcoticForm] = useState<NarcoticForm>(emptyNarcoticForm);
  const [narcoticBusy, setNarcoticBusy] = useState(false);
  const [editNarcotic, setEditNarcotic] = useState<Record<string, unknown> | null>(null);
  const [deleteNarcoticTarget, setDeleteNarcoticTarget] = useState<Record<string, unknown> | null>(null);

  const narcotics = useQuery({
    queryKey: ['narcotic-registry'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/narcotic-registry?page=1&pageSize=200'),
  });

  async function submitNarcotic(event: FormEvent) {
    event.preventDefault();
    if (narcoticBusy) return;
    const quantity = Number(narcoticForm.quantity);
    if (!narcoticForm.recordDate || !narcoticForm.itemId || !Number.isSafeInteger(quantity) || quantity < 0) {
      showToast('请填写登记日期、麻药物品和有效的麻药数量', 'error');
      return;
    }
    setNarcoticBusy(true);
    try {
      await apiRequest('/narcotic-registry', {
        method: 'POST',
        body: JSON.stringify({
          recordDate: narcoticForm.recordDate,
          itemId: narcoticForm.itemId,
          batchNo: narcoticForm.batchNo.trim() || undefined,
          quantity,
          usage: narcoticForm.usage.trim() || undefined,
          balanceBefore: narcoticForm.balanceBefore.trim() === '' ? undefined : Number(narcoticForm.balanceBefore),
          balanceAfter: narcoticForm.balanceAfter.trim() === '' ? undefined : Number(narcoticForm.balanceAfter),
          remark: narcoticForm.remark.trim() || undefined,
        }),
      });
      showToast('麻药登记成功', 'success');
      setNarcoticForm(emptyNarcoticForm());
      void narcotics.refetch();
    } catch (error) {
      showToast(errorMessage(error, '麻药登记失败'), 'error');
    } finally {
      setNarcoticBusy(false);
    }
  }

  async function confirmDeleteNarcotic() {
    if (!deleteNarcoticTarget) return;
    try {
      await apiRequest(`/narcotic-registry/${String(deleteNarcoticTarget.id)}`, { method: 'DELETE' });
      showToast('麻药登记已删除', 'success');
      setDeleteNarcoticTarget(null);
      void narcotics.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除麻药登记失败'), 'error');
    }
  }

  const narcoticColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'recordDate', label: '日期' },
    { key: 'itemName', label: '物品', render: (row) => String(row.itemName ?? row.itemId ?? '') },
    { key: 'batchNo', label: '批号', render: (row) => String(row.batchNo ?? '') },
    { key: 'quantity', label: '数量', render: (row) => String(row.quantity ?? '') },
    { key: 'usage', label: '用途', render: (row) => String(row.usage ?? '') },
    { key: 'balanceBefore', label: '余量前', render: (row) => String(row.balanceBefore ?? '') },
    { key: 'balanceAfter', label: '余量后', render: (row) => String(row.balanceAfter ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <span className="row-actions">
          <button type="button" onClick={() => setEditNarcotic(row)}>编辑</button>
          <button type="button" onClick={() => setDeleteNarcoticTarget(row)}>删除</button>
        </span>
      ),
    },
  ];

  return (
    <>
      <section className="card">
        <h2>麻药登记</h2>
        <form className="inline-form" onSubmit={submitNarcotic}>
          <label>
            登记日期
            <input
              aria-label="登记日期"
              type="date"
              value={narcoticForm.recordDate}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, recordDate: event.target.value }))}
            />
          </label>
          <label>
            麻药物品
            <SearchableSelect
              resource="inventoryItems"
              value={narcoticForm.itemId}
              onChange={(id) => setNarcoticForm((current) => ({ ...current, itemId: id }))}
              ariaLabel="麻药物品"
              placeholder="选择麻药物品"
            />
          </label>
          <label>
            批号
            <input
              aria-label="批号"
              value={narcoticForm.batchNo}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, batchNo: event.target.value }))}
            />
          </label>
          <label>
            麻药数量
            <input
              aria-label="麻药数量"
              type="number"
              min="0"
              value={narcoticForm.quantity}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, quantity: event.target.value }))}
            />
          </label>
          <label>
            用途
            <input
              aria-label="用途"
              value={narcoticForm.usage}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, usage: event.target.value }))}
            />
          </label>
          <label>
            余量前
            <input
              aria-label="余量前"
              type="number"
              min="0"
              value={narcoticForm.balanceBefore}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, balanceBefore: event.target.value }))}
            />
          </label>
          <label>
            余量后
            <input
              aria-label="余量后"
              type="number"
              min="0"
              value={narcoticForm.balanceAfter}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, balanceAfter: event.target.value }))}
            />
          </label>
          <label>
            备注
            <textarea
              aria-label="备注"
              value={narcoticForm.remark}
              onChange={(event) => setNarcoticForm((current) => ({ ...current, remark: event.target.value }))}
            />
          </label>
          <button type="submit" disabled={narcoticBusy}>{narcoticBusy ? '登记中...' : '登记'}</button>
        </form>
      </section>

      <section className="card">
        <h2>麻药登记记录</h2>
        {narcotics.isLoading ? (
          <LoadingState label="加载麻药登记..." />
        ) : narcotics.error ? (
          <PageError message={errorMessage(narcotics.error, '加载麻药登记失败')} />
        ) : (
          <>
            <DataTable columns={narcoticColumns} rows={narcotics.data?.items ?? []} keyField="id" emptyText="暂无麻药登记" />
            {narcotics.data?.truncated ? (
              <p className="reminder-muted">
                麻药登记超过 {narcotics.data.pageSize} 条，仅显示前 {narcotics.data.items.length} 条
              </p>
            ) : null}
          </>
        )}
      </section>

      {editNarcotic && (
        <NarcoticEditDialog
          record={editNarcotic}
          onClose={() => setEditNarcotic(null)}
          onDone={() => void narcotics.refetch()}
        />
      )}
      <ConfirmDialog
        open={deleteNarcoticTarget !== null}
        title="删除麻药登记"
        message="确定删除该麻药登记吗？"
        confirmText="删除"
        danger
        onConfirm={() => confirmDeleteNarcotic()}
        onCancel={() => setDeleteNarcoticTarget(null)}
      />
    </>
  );
}

/** 编辑麻药登记弹窗：从列表行预填全部可编辑字段，提交 PATCH /narcotic-registry/:id。 */
function NarcoticEditDialog({
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
