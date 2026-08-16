import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import {
  ConfirmDialog,
  DataTable,
  LoadingState,
  PageError,
  PagePager,
  SearchableSelect,
} from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { useAsyncAction } from '../hooks/use-async-action';
import type { Page } from '../lib/types';
import { emptyNarcoticForm, type NarcoticForm } from './types';
import { narcoticColumns } from './narcotic-columns';
import { NarcoticEditDialog } from './NarcoticEditDialog';

/** 麻药登记面板：登记表单与登记记录列表，narcotics 查询、表单状态与删除/编辑逻辑均在本面板内部。 */
export function DispenseNarcoticPanel() {
  const { showToast } = useToast();
  const [narcoticForm, setNarcoticForm] = useState<NarcoticForm>(emptyNarcoticForm);
  const { busy: narcoticBusy, run: runNarcotic } = useAsyncAction();
  const [editNarcotic, setEditNarcotic] = useState<Record<string, unknown> | null>(null);
  const [deleteNarcoticTarget, setDeleteNarcoticTarget] = useState<Record<string, unknown> | null>(null);
  const [narcoticPage, setNarcoticPage] = useState(1);

  const narcotics = useQuery({
    queryKey: ['narcotic-registry', narcoticPage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/narcotic-registry?page=${narcoticPage}&pageSize=200`),
  });

  async function submitNarcotic(event: FormEvent) {
    event.preventDefault();
    if (narcoticBusy) return;
    const quantity = Number(narcoticForm.quantity);
    if (!narcoticForm.recordDate || !narcoticForm.itemId || !Number.isSafeInteger(quantity) || quantity < 0) {
      showToast('请填写登记日期、麻药物品和有效的麻药数量', 'error');
      return;
    }
    await runNarcotic(async () => {
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
      }
    });
  }

  async function confirmDeleteNarcotic() {
    if (!deleteNarcoticTarget) return;
    const targetId = String(deleteNarcoticTarget.id);
    await runNarcotic(async () => {
      try {
        await apiRequest(`/narcotic-registry/${targetId}`, { method: 'DELETE' });
        showToast('麻药登记已删除', 'success');
        setDeleteNarcoticTarget(null);
        void narcotics.refetch();
      } catch (error) {
        showToast(errorMessage(error, '删除麻药登记失败'), 'error');
      }
    });
  }

  const columns = narcoticColumns({
    onEdit: (row) => setEditNarcotic(row),
    onDelete: (row) => setDeleteNarcoticTarget(row),
  });

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
            <DataTable columns={columns} rows={narcotics.data?.items ?? []} keyField="id" emptyText="暂无麻药登记" />
            <PagePager
              page={narcoticPage}
              hasNext={narcoticPage * 200 < (narcotics.data?.total ?? 0)}
              onPageChange={setNarcoticPage}
              disabled={narcotics.isFetching}
            />
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
