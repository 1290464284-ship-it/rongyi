import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import {
  ConfirmDialog,
  DataTable,
  Dialog,
  LoadingState,
  PageError,
  SearchableSelect,
  type DataTableColumn,
} from './components';
import { formatDateTime, todayLocalDate } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const DISPENSE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待发药',
  PARTIAL: '部分发药',
  DISPENSED: '已发药',
  RETURNED: '已退药',
};

interface DispenseRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  pharmacistName?: string | null;
  status?: string | null;
  itemsCount?: number;
  dispensedAt?: string | null;
  returnedAt?: string | null;
  note?: string | null;
  createdAt?: string | null;
}

interface DispenseDetailItem {
  id: string;
  itemId?: string;
  batchId?: string | null;
  name?: string | null;
  spec?: string | null;
  quantity?: number;
  returnedQuantity?: number;
  batchManaged?: number;
  stock?: number;
}

interface DispenseDetail extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  note?: string | null;
  status?: string | null;
  items: DispenseDetailItem[];
}

interface CreateItemRow {
  key: string;
  /** 已存在明细行的服务端 id（编辑回填时携带，提交时回传用于更新）。 */
  id?: string;
  itemId: string;
  quantity: string;
  batchId: string;
}

interface CreateForm {
  number: string;
  patientId: string;
  note: string;
  items: CreateItemRow[];
}

interface NarcoticForm {
  recordDate: string;
  itemId: string;
  batchNo: string;
  quantity: string;
  usage: string;
  balanceBefore: string;
  balanceAfter: string;
  remark: string;
}

function newCreateItem(): CreateItemRow {
  return { key: crypto.randomUUID(), itemId: '', quantity: '1', batchId: '' };
}

function emptyCreateForm(): CreateForm {
  return { number: '', patientId: '', note: '', items: [newCreateItem()] };
}

function emptyNarcoticForm(): NarcoticForm {
  return {
    recordDate: todayLocalDate(),
    itemId: '',
    batchNo: '',
    quantity: '',
    usage: '',
    balanceBefore: '',
    balanceAfter: '',
    remark: '',
  };
}

/**
 * 药房工作台：发药单列表与发药/退药操作、新建发药单、麻药登记。
 *
 * 发药/退药以行内面板展开，面板内按明细选择批次（仅批次管理物品）或填写退回数量；
 * 所有提交成功后刷新列表并给出 Toast 反馈。
 */
export function DispenseWorkbenchPage() {
  const { showToast } = useToast();
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
  const [narcoticForm, setNarcoticForm] = useState<NarcoticForm>(emptyNarcoticForm);
  // 物品 id -> 是否批次管理；由“物品”下拉的 onLoaded 回填，用于按行渲染“批次”下拉
  const [itemsMeta, setItemsMeta] = useState<Record<string, boolean>>({});
  const [createBusy, setCreateBusy] = useState(false);
  const [narcoticBusy, setNarcoticBusy] = useState(false);
  const [action, setAction] = useState<{ mode: 'dispense' | 'return'; row: DispenseRow } | null>(null);
  const [editDispenseId, setEditDispenseId] = useState<string | null>(null);
  const [deleteDispenseTarget, setDeleteDispenseTarget] = useState<DispenseRow | null>(null);
  const [editNarcotic, setEditNarcotic] = useState<Record<string, unknown> | null>(null);
  const [deleteNarcoticTarget, setDeleteNarcoticTarget] = useState<Record<string, unknown> | null>(null);

  const dispenses = useQuery({
    queryKey: ['dispenses'],
    queryFn: () => apiRequest<DispenseRow[]>('/dispenses'),
  });
  const narcotics = useQuery({
    queryKey: ['narcotic-registry'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/narcotic-registry'),
  });

  function updateCreate(patch: Partial<CreateForm>) {
    setCreateForm((current) => ({ ...current, ...patch }));
  }

  function updateCreateItem(key: string, patch: Partial<CreateItemRow>) {
    setCreateForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }));
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (createBusy) return;
    const items = createForm.items
      .filter((item) => item.itemId !== '' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0)
      .map((item) => ({
        itemId: item.itemId,
        quantity: Number(item.quantity),
        batchId: item.batchId.trim() === '' ? undefined : item.batchId.trim(),
      }));
    if (!createForm.patientId || !createForm.number.trim() || items.length === 0) {
      showToast('请选择患者、填写单号并至少填写一条有效发药明细', 'error');
      return;
    }
    setCreateBusy(true);
    try {
      await apiRequest('/dispenses', {
        method: 'POST',
        body: JSON.stringify({
          number: createForm.number.trim(),
          patientId: createForm.patientId,
          note: createForm.note.trim() || undefined,
          items,
        }),
      });
      showToast('发药单已创建', 'success');
      setCreateForm(emptyCreateForm());
      void dispenses.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建发药单失败'), 'error');
    } finally {
      setCreateBusy(false);
    }
  }

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

  async function confirmDeleteDispense() {
    if (!deleteDispenseTarget) return;
    try {
      await apiRequest(`/dispenses/${deleteDispenseTarget.id}`, { method: 'DELETE' });
      showToast('发药单已删除', 'success');
      setDeleteDispenseTarget(null);
      void dispenses.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除发药单失败'), 'error');
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
    <div className="page">
      <div className="page-head">
        <h1>药房工作台</h1>
      </div>

      <section className="card">
        <h2>发药单</h2>
        {dispenses.isLoading ? (
          <LoadingState label="加载发药单..." />
        ) : dispenses.error ? (
          <PageError message={errorMessage(dispenses.error, '加载发药单失败')} />
        ) : (
          <DataTable columns={dispenseColumns} rows={dispenses.data ?? []} keyField="id" emptyText="暂无发药单" />
        )}
        {action && (
          <DispenseActionPanel
            mode={action.mode}
            row={action.row}
            onClose={() => setAction(null)}
            onDone={() => void dispenses.refetch()}
          />
        )}
      </section>

      <section className="card">
        <h2>新建发药单</h2>
        <form className="inline-form" onSubmit={submitCreate}>
          <label>
            患者
            <SearchableSelect
              resource="patients"
              value={createForm.patientId}
              onChange={(id) => updateCreate({ patientId: id })}
              ariaLabel="患者"
              placeholder="选择患者"
            />
          </label>
          <label>
            单号
            <input aria-label="单号" value={createForm.number} onChange={(event) => updateCreate({ number: event.target.value })} />
          </label>
          <label>
            发药备注
            <input aria-label="发药备注" value={createForm.note} onChange={(event) => updateCreate({ note: event.target.value })} />
          </label>
          {createForm.items.map((item) => (
            <div className="charge-item-row" key={item.key}>
              <SearchableSelect
                resource="inventoryItems"
                value={item.itemId}
                onChange={(id) => updateCreateItem(item.key, { itemId: id, batchId: '' })}
                ariaLabel="物品"
                placeholder="选择物品"
                onLoaded={(rows) => {
                  setItemsMeta((current) => {
                    const next = { ...current };
                    for (const row of rows) next[String(row.id)] = Number(row.batchManaged ?? 0) === 1;
                    return next;
                  });
                }}
              />
              <input
                aria-label="发药数量"
                type="number"
                min="1"
                value={item.quantity}
                onChange={(event) => updateCreateItem(item.key, { quantity: event.target.value })}
              />
              {itemsMeta[item.itemId] === true && (
                <BatchSelect
                  itemId={item.itemId}
                  value={item.batchId}
                  onChange={(batchId) => updateCreateItem(item.key, { batchId })}
                  ariaLabel="批次"
                />
              )}
              <button type="button" onClick={() => updateCreate({ items: createForm.items.filter((entry) => entry.key !== item.key) })}>
                移除
              </button>
            </div>
          ))}
          <button type="button" onClick={() => updateCreate({ items: [...createForm.items, newCreateItem()] })}>添加明细</button>
          <button type="submit" disabled={createBusy}>{createBusy ? '创建中...' : '创建发药单'}</button>
        </form>
      </section>

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
          <DataTable columns={narcoticColumns} rows={narcotics.data ?? []} keyField="id" emptyText="暂无麻药登记" />
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
        onConfirm={() => void confirmDeleteNarcotic()}
        onCancel={() => setDeleteNarcoticTarget(null)}
      />
    </div>
  );
}

/** 编辑发药单弹窗：拉取详情回填表单（明细行携带服务端 id），提交 PATCH /dispenses/:id。 */
function DispenseEditDialog({
  dispenseId,
  onClose,
  onDone,
}: {
  dispenseId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<CreateForm | null>(null);
  const [itemsMeta, setItemsMeta] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const detail = useQuery({
    queryKey: ['dispense-detail', dispenseId],
    queryFn: () => apiRequest<DispenseDetail>(`/dispenses/${dispenseId}`),
  });

  // 详情到达后回填一次表单；明细行以服务端 id 作为 key，提交时回传
  useEffect(() => {
    if (!detail.data || form !== null) return;
    setForm({
      number: String(detail.data.number ?? ''),
      patientId: String(detail.data.patientId ?? ''),
      note: String(detail.data.note ?? ''),
      items: (detail.data.items ?? []).map((item) => ({
        key: item.id,
        id: item.id,
        itemId: String(item.itemId ?? ''),
        quantity: String(Number(item.quantity ?? 0)),
        batchId: String(item.batchId ?? ''),
      })),
    });
  }, [detail.data, form]);

  function updateForm(patch: Partial<CreateForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function updateItem(key: string, patch: Partial<CreateItemRow>) {
    setForm((current) => (current
      ? { ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) }
      : current));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !form) return;
    const items = form.items
      .filter((item) => item.itemId !== '' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0)
      .map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        itemId: item.itemId,
        quantity: Number(item.quantity),
        batchId: item.batchId.trim() === '' ? undefined : item.batchId.trim(),
      }));
    if (!form.patientId || !form.number.trim() || items.length === 0) {
      showToast('请选择患者、填写单号并至少填写一条有效发药明细', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/dispenses/${dispenseId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          number: form.number.trim(),
          patientId: form.patientId,
          note: form.note.trim() || undefined,
          items,
        }),
      });
      showToast('发药单已更新', 'success');
      onClose();
      onDone();
    } catch (error) {
      showToast(errorMessage(error, '更新发药单失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="编辑发药单" onClose={onClose}>
      {detail.error ? (
        <PageError message={errorMessage(detail.error, '加载发药单失败')} />
      ) : detail.isLoading || !form ? (
        <LoadingState label="加载发药单..." />
      ) : (
        <form className="inline-form" onSubmit={submit}>
          <label>
            患者
            <SearchableSelect
              resource="patients"
              value={form.patientId}
              onChange={(id) => updateForm({ patientId: id })}
              ariaLabel="编辑患者"
              placeholder="选择患者"
            />
          </label>
          <label>
            单号
            <input aria-label="编辑单号" value={form.number} onChange={(event) => updateForm({ number: event.target.value })} />
          </label>
          <label>
            发药备注
            <input aria-label="编辑发药备注" value={form.note} onChange={(event) => updateForm({ note: event.target.value })} />
          </label>
          {form.items.map((item) => (
            <div className="charge-item-row" key={item.key}>
              <SearchableSelect
                resource="inventoryItems"
                value={item.itemId}
                onChange={(id) => updateItem(item.key, { itemId: id, batchId: '' })}
                ariaLabel="编辑物品"
                placeholder="选择物品"
                onLoaded={(rows) => {
                  setItemsMeta((current) => {
                    const next = { ...current };
                    for (const row of rows) next[String(row.id)] = Number(row.batchManaged ?? 0) === 1;
                    return next;
                  });
                }}
              />
              <input
                aria-label="编辑发药数量"
                type="number"
                min="1"
                value={item.quantity}
                onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
              />
              {itemsMeta[item.itemId] === true && (
                <BatchSelect
                  itemId={item.itemId}
                  value={item.batchId}
                  onChange={(batchId) => updateItem(item.key, { batchId })}
                  ariaLabel="编辑批次"
                />
              )}
              <button type="button" onClick={() => updateForm({ items: form.items.filter((entry) => entry.key !== item.key) })}>
                移除
              </button>
            </div>
          ))}
          <button type="button" onClick={() => updateForm({ items: [...form.items, { ...newCreateItem() }] })}>添加明细</button>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" disabled={busy}>{busy ? '保存中...' : '保存修改'}</button>
          </div>
        </form>
      )}
    </Dialog>
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

/** 批次下拉：加载指定物品的可选批次（剩余量）。 */
function BatchSelect({
  itemId,
  value,
  onChange,
  ariaLabel,
}: {
  itemId: string;
  value: string;
  onChange: (batchId: string) => void;
  ariaLabel: string;
}) {
  const batches = useQuery({
    queryKey: ['inventory-batches', itemId],
    queryFn: () =>
      apiRequest<{ batches: Array<Record<string, unknown>> }>(`/inventory-batches?itemId=${encodeURIComponent(itemId)}`),
    enabled: itemId !== '',
  });
  const rows = batches.data?.batches ?? [];
  return (
    <span className="searchable-select">
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">选择批次</option>
        {rows.map((batch) => (
          <option key={String(batch.id)} value={String(batch.id)}>
            {String(batch.batchNo ?? batch.id)}
          </option>
        ))}
      </select>
      {batches.error && <span className="error">{errorMessage(batches.error)}</span>}
    </span>
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
