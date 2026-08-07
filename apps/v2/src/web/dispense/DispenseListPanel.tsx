import { useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../api';
import type { Page } from '../types';
import {
  ConfirmDialog,
  DataTable,
  LoadingState,
  PageError,
  type DataTableColumn,
} from '../components';
import { formatDateTime } from '../format';
import { errorMessage } from '../messages';
import { useToast } from '../toast-context';
import { BatchSelect, DispenseEditDialog } from './DispenseEditDialog';
import type { DispenseDetail, DispenseDetailItem, DispenseRow } from './dispense-types';

const DISPENSE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待发药',
  PARTIAL: '部分发药',
  DISPENSED: '已发药',
  RETURNED: '已退药',
};

/** 发药单列表区：分页、行内发药/退药面板、编辑与删除确认；列表查询与分页状态由页面传入。 */
export function DispenseListPanel({
  dispenses,
  dispensePage,
  setDispensePage,
}: {
  dispenses: UseQueryResult<Page<DispenseRow>, Error>;
  dispensePage: number;
  setDispensePage: Dispatch<SetStateAction<number>>;
}) {
  const { showToast } = useToast();
  const [action, setAction] = useState<{ mode: 'dispense' | 'return'; row: DispenseRow } | null>(null);
  const [editDispenseId, setEditDispenseId] = useState<string | null>(null);
  const [deleteDispenseTarget, setDeleteDispenseTarget] = useState<DispenseRow | null>(null);

  async function confirmDeleteDispense() {
    if (!deleteDispenseTarget) return;
    try {
      await apiRequest(`/dispenses/${deleteDispenseTarget.id}`, { method: 'DELETE' });
      showToast('发药单已删除', 'success');
      setDeleteDispenseTarget(null);
      const refreshed = await dispenses.refetch();
      // 删除末页最后一条时回退一页，避免停留在空页
      if (dispensePage > 1 && (refreshed.data?.items?.length ?? 0) === 0) {
        setDispensePage((value) => value - 1);
      }
    } catch (error) {
      showToast(errorMessage(error, '删除发药单失败'), 'error');
    }
  }

  const dispenseColumns: DataTableColumn<DispenseRow>[] = [
    { key: 'number', label: '单号' },
    { key: 'patientName', label: '患者', render: (row) => row.patientName ?? row.patientId ?? '' },
    { key: 'itemsCount', label: '明细数', render: (row) => String(Number(row.itemsCount ?? 0)) },
    {
      key: 'status',
      label: '状态',
      render: (row) => DISPENSE_STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    { key: 'createdAt', label: '创建时间', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => {
        const status = String(row.status ?? '');
        return (
          <span className="row-actions">
            {(status === 'PENDING' || status === 'PARTIAL') && (
              <button type="button" onClick={() => setAction({ mode: 'dispense', row })}>发药</button>
            )}
            {(status === 'DISPENSED' || status === 'PARTIAL') && (
              <button type="button" onClick={() => setAction({ mode: 'return', row })}>退药</button>
            )}
            {status === 'PENDING' && (
              <>
                <button type="button" onClick={() => setEditDispenseId(row.id)}>编辑</button>
                <button type="button" onClick={() => setDeleteDispenseTarget(row)}>删除</button>
              </>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <section className="card">
        <h2>发药单</h2>
        {dispenses.isLoading ? (
          <LoadingState label="加载发药单..." />
        ) : dispenses.error ? (
          <PageError message={errorMessage(dispenses.error, '加载发药单失败')} />
        ) : (
          <DataTable columns={dispenseColumns} rows={dispenses.data?.items ?? []} keyField="id" emptyText="暂无发药单" />
        )}
        <div className="pager">
          <button disabled={dispensePage <= 1} onClick={() => setDispensePage((value) => value - 1)}>上一页</button>
          <span>第 {dispensePage} 页</span>
          <button
            disabled={!dispenses.data || dispensePage * 20 >= dispenses.data.total}
            onClick={() => setDispensePage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
        {action && (
          <DispenseActionPanel
            mode={action.mode}
            row={action.row}
            onClose={() => setAction(null)}
            onDone={() => void dispenses.refetch()}
          />
        )}
      </section>
      {editDispenseId && (
        <DispenseEditDialog
          dispenseId={editDispenseId}
          onClose={() => setEditDispenseId(null)}
          onDone={() => void dispenses.refetch()}
        />
      )}
      <ConfirmDialog
        open={deleteDispenseTarget !== null}
        title="删除发药单"
        message="确定删除该发药单吗？"
        confirmText="删除"
        danger
        onConfirm={() => void confirmDeleteDispense()}
        onCancel={() => setDeleteDispenseTarget(null)}
      />
    </>
  );
}

/** 行内操作面板：发药（按明细选批次）或退药（按明细填退回数量）。 */
function DispenseActionPanel({
  mode,
  row,
  onClose,
  onDone,
}: {
  mode: 'dispense' | 'return';
  row: DispenseRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [batchSelections, setBatchSelections] = useState<Record<string, string>>({});
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const detail = useQuery({
    queryKey: ['dispense-detail', row.id],
    queryFn: () => apiRequest<DispenseDetail>(`/dispenses/${row.id}`),
  });

  const pendingQuantity = (item: DispenseDetailItem): number =>
    Number(item.quantity ?? 0) - Number(item.returnedQuantity ?? 0);

  async function submit() {
    if (busy || !detail.data) return;
    if (mode === 'dispense') {
      const missingBatch = detail.data.items.some(
        (item) => Number(item.batchManaged ?? 0) === 1 && !(batchSelections[item.id] ?? item.batchId ?? ''),
      );
      if (missingBatch) {
        showToast('请为批次管理物品选择批次', 'error');
        return;
      }
      const items = detail.data.items.map((item) => {
        const isBatchManaged = Number(item.batchManaged ?? 0) === 1;
        return {
          dispenseItemId: item.id,
          batchId: isBatchManaged ? (batchSelections[item.id] ?? item.batchId ?? null) : null,
        };
      });
      setBusy(true);
      try {
        await apiRequest(`/dispenses/${row.id}/dispense`, {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
        showToast('发药成功', 'success');
        onClose();
        onDone();
      } catch (error) {
        showToast(errorMessage(error, '发药失败'), 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    const items = detail.data.items
      .map((item) => ({ dispenseItemId: item.id, quantity: Number(returnQuantities[item.id] ?? '') }))
      .filter((entry) => Number.isSafeInteger(entry.quantity) && entry.quantity > 0);
    if (items.length === 0) {
      showToast('请填写退回数量', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<{ status?: string }>(`/dispenses/${row.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      showToast(result.status === 'RETURNED' ? '已全部退药' : '退药成功', 'success');
      onClose();
      onDone();
    } catch (error) {
      showToast(errorMessage(error, '退药失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card action-panel" aria-label={mode === 'dispense' ? '发药操作' : '退药操作'}>
      <div className="page-head">
        <h3>{mode === 'dispense' ? `发药：${row.number ?? row.id}` : `退药：${row.number ?? row.id}`}</h3>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
      {detail.isLoading ? (
        <LoadingState label="加载明细..." />
      ) : detail.error ? (
        <PageError message={errorMessage(detail.error, '加载明细失败')} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>物品</th>
                <th>{mode === 'dispense' ? '待发数量' : '未退数量'}</th>
                <th>{mode === 'dispense' ? '批次' : '退回数量'}</th>
              </tr>
            </thead>
            <tbody>
              {(detail.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{String(item.name ?? '')}{item.spec ? `（${item.spec}）` : ''}</td>
                  <td>{String(pendingQuantity(item))}</td>
                  <td>
                    {mode === 'dispense' ? (
                      Number(item.batchManaged ?? 0) === 1 ? (
                        <BatchSelect
                          itemId={String(item.itemId ?? '')}
                          value={batchSelections[item.id] ?? item.batchId ?? ''}
                          onChange={(batchId) => setBatchSelections((current) => ({ ...current, [item.id]: batchId }))}
                          ariaLabel="发药批次"
                        />
                      ) : (
                        <span>—</span>
                      )
                    ) : (
                      <input
                        type="number"
                        min="1"
                        max={pendingQuantity(item)}
                        aria-label="退回数量"
                        value={returnQuantities[item.id] ?? ''}
                        onChange={(event) =>
                          setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" disabled={busy || detail.isLoading || !detail.data} onClick={() => void submit()}>
          {mode === 'dispense' ? '确认发药' : '确认退药'}
        </button>
      </div>
    </section>
  );
}
