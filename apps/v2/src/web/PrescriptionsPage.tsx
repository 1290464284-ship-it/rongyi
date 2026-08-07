import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, fetchAllPages } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, LoadingState, PageError, SearchableSelect, type DataTableColumn } from './components';
import { formatDateTime, centsToYuanString, toCents } from './format';
import { errorMessage } from './messages';
import { useAsyncAction } from './use-async-action';
import { useToast, type ToastKind } from './toast-context';

interface PrescriptionRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  remark?: string | null;
  status?: string | null;
  processedAt?: string | null;
  chargeId?: string | null;
  chargeIdLabel?: string | null;
  dispenseId?: string | null;
}

/** POST /prescriptions/:id/process 返回的划价单 + 领药单信息。 */
interface PrescriptionProcessResult {
  prescriptionId: string;
  status: string;
  chargeId: string;
  chargeNumber: string;
  chargeTotalAmount: number;
  dispenseId: string;
  dispenseNumber: string;
  itemCount: number;
}

/** GET /prescriptions/:id/status 返回的处理状态。 */
interface PrescriptionStatusResult {
  id: string;
  status: string;
  processedAt: string | null;
  chargeId: string | null;
  dispenseId: string | null;
}

const PRESCRIPTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待处理',
  PROCESSED: '已处理',
};

function statusLabel(status: string | null | undefined): string {
  const value = status ?? 'DRAFT';
  return PRESCRIPTION_STATUS_LABELS[value] ?? value;
}

interface PrescriptionItemForm {
  id: string;
  name: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: string;
  quantity: string;
  price: string;
}

interface PrescriptionForm {
  patientId: string;
  doctorId: string;
  remark: string;
  status: string;
  items: PrescriptionItemForm[];
}

function newItem(): PrescriptionItemForm {
  return { id: crypto.randomUUID(), name: '', spec: '', dosage: '', frequency: '', days: '1', quantity: '1', price: '' };
}

function emptyForm(): PrescriptionForm {
  return { patientId: '', doctorId: '', remark: '', status: 'DRAFT', items: [newItem()] };
}

const ITEM_FIELDS: Array<{ key: keyof PrescriptionItemForm; label: string; placeholder: string; type?: 'number'; min?: number }> = [
  { key: 'name', label: '药品名称', placeholder: '药品名称' },
  { key: 'spec', label: '规格', placeholder: '规格' },
  { key: 'dosage', label: '剂量', placeholder: '剂量' },
  { key: 'frequency', label: '频次', placeholder: '频次' },
  { key: 'days', label: '天数', placeholder: '', type: 'number', min: 1 },
  { key: 'quantity', label: '数量', placeholder: '', type: 'number', min: 1 },
  { key: 'price', label: '单价', placeholder: '', type: 'number', min: 0 },
];

function validItems(form: PrescriptionForm) {
  return form.items
    .filter((item) => item.name.trim() && item.days && item.quantity && item.price)
    .map((item) => ({
      name: item.name.trim(),
      specification: item.spec || undefined,
      dosage: item.dosage || undefined,
      frequency: item.frequency || undefined,
      days: Number(item.days),
      quantity: Number(item.quantity),
      price: toCents(item.price),
    }))
    .filter((item) => item.days > 0 && item.quantity > 0 && item.price >= 0);
}

/** 单条明细提交 payload（编辑 PATCH/POST 用；字段与后端 prescriptionItems 定义一致）。 */
interface ItemPayload {
  name: string;
  specification?: string;
  dosage?: string;
  frequency?: string;
  days: number;
  quantity: number;
  price: number;
}

function itemPayload(item: PrescriptionItemForm): ItemPayload {
  return {
    name: item.name.trim(),
    specification: item.spec || undefined,
    dosage: item.dosage || undefined,
    frequency: item.frequency || undefined,
    days: Number(item.days),
    quantity: Number(item.quantity),
    price: toCents(item.price),
  };
}

/** 服务端明细行 → 编辑表单明细（price 分 → 元字符串）。 */
function itemRowToForm(row: Record<string, unknown>): PrescriptionItemForm {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    spec: String(row.specification ?? ''),
    dosage: String(row.dosage ?? ''),
    frequency: String(row.frequency ?? ''),
    days: String(row.days ?? ''),
    quantity: String(row.quantity ?? ''),
    price: centsToYuanString(row.price ?? 0),
  };
}

const prescriptionColumns: DataTableColumn<PrescriptionRow>[] = [
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'remark', label: '备注' },
  { key: 'status', label: '状态', render: (row) => statusLabel(row.status) },
  { key: 'processedAt', label: '处理时间', render: (row) => formatDateTime(row.processedAt) },
  { key: 'chargeId', label: '划价单', render: (row) => row.chargeIdLabel ?? row.chargeId ?? '' },
  { key: 'dispenseId', label: '领药单', render: (row) => String(row.dispenseId ?? '') },
];

export function PrescriptionsPage() {
  const { showToast } = useToast();
  const [statusTarget, setStatusTarget] = useState<{ row: PrescriptionRow; reload: () => Promise<unknown> } | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const updateFormRef = useRef<((patch: Partial<PrescriptionForm>) => void) | null>(null);
  const [editLoadKey, setEditLoadKey] = useState(0);

  // 编辑打开时异步加载该处方的明细行并回填表单 items（formFromRow 是同步的，无法 await）。
  useEffect(() => {
    if (editLoadKey === 0) return;
    const prescriptionId = editingIdRef.current;
    if (!prescriptionId) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchAllPages<Record<string, unknown>>(
          `/resources/prescriptionItems?prescriptionId=${prescriptionId}`,
        );
        if (!cancelled) updateFormRef.current?.({ items: items.map(itemRowToForm) });
      } catch (error) {
        showToast(errorMessage(error, '加载处方明细失败'), 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [editLoadKey, showToast]);

  return (
    <>
      <CrudPage<PrescriptionRow, PrescriptionForm>
        title="处方管理"
        createLabel="新建处方"
        emptyMessage="暂无处方"
        queryKey={['prescriptions']}
        endpoint="/resources/prescriptions"
        initialForm={() => {
          editingIdRef.current = null;
          return emptyForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          setEditLoadKey((key) => key + 1);
          return {
            patientId: String(row.patientId ?? ''),
            doctorId: String(row.doctorId ?? ''),
            remark: String(row.remark ?? ''),
            status: String(row.status ?? 'DRAFT'),
            items: [],
          };
        }}
        validate={(form) =>
          !form.patientId || !form.doctorId || validItems(form).length === 0
            ? '请选择患者、医生并至少填写一条有效处方明细'
            : null
        }
        submitOverride={({ form, editing }) => {
          // L1：与采购单一致，填了名称但数量/单价无效的明细会被静默丢弃，提交前提示
          const dropped = form.items.filter((item) => item.name.trim()).length - validItems(form).length;
          if (dropped > 0) showToast(`${dropped} 条明细因数量或单价无效将被忽略`, 'info');
          return editing ? updatePrescription(form, editingIdRef.current) : createPrescription(form);
        }}
        messages={{ create: '处方已创建', update: '处方已更新', delete: '处方已删除' }}
        errorMessages={{ create: '创建处方失败', update: '更新处方失败', delete: '删除处方失败' }}
        deleteOverride={async (row) => {
          // 服务端 DELETE 为软删除且不级联：先删全部明细，再删主记录（明细删除失败仅告警）
          const prescriptionId = String(row.id);
          try {
            const items = await fetchAllPages<Record<string, unknown>>(
              `/resources/prescriptionItems?prescriptionId=${prescriptionId}`,
            );
            for (const item of items) {
              await apiRequest(`/resources/prescriptionItems/${String(item.id)}`, { method: 'DELETE' });
            }
          } catch (error) {
            console.warn(`删除处方明细失败（继续删除主记录）：${prescriptionId}`, error);
          }
          await apiRequest(`/resources/prescriptions/${prescriptionId}`, { method: 'DELETE' });
        }}
        columns={prescriptionColumns}
        canEdit
        canDelete
        dialogTitle={(editing) => (editing ? '编辑处方' : '新建处方')}
        rowActions={(row, ctx) =>
          row.status === 'PROCESSED' ? (
            <button onClick={() => setStatusTarget({ row, reload: ctx.reload })}>查看状态</button>
          ) : (
            <ProcessPrescriptionButton
              row={row}
              reload={ctx.reload}
              showToast={showToast}
            />
          )
        }
        renderForm={(ctx) => (
          <>
            <FormUpdateSync update={ctx.update} onUpdate={(update) => { updateFormRef.current = update; }} />
            <PrescriptionForm form={ctx.form} update={ctx.update} editing={ctx.editing} />
          </>
        )}
      />

      <Dialog open={statusTarget !== null} title="处方状态" onClose={() => setStatusTarget(null)}>
        {statusTarget && (
          <PrescriptionStatusDialog
            row={statusTarget.row}
            onClose={() => setStatusTarget(null)}
            onChanged={statusTarget.reload}
          />
        )}
      </Dialog>
    </>
  );
}

/** 行内“处理”按钮：busy 期间禁用，防止双击重复生成划价单与领药单。 */
function ProcessPrescriptionButton({
  row,
  reload,
  showToast,
}: {
  row: PrescriptionRow;
  reload: () => Promise<unknown>;
  showToast: (message: string, kind?: ToastKind) => void;
}) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy} onClick={() => run(() => processPrescription(row, reload, showToast))}>
      {busy ? '处理中...' : '处理'}
    </button>
  );
}

async function createPrescription(form: PrescriptionForm): Promise<void> {
  const items = validItems(form);
  let prescriptionId: string | null = null;
  const createdItemIds: string[] = [];
  try {
    const prescription = await apiRequest<{ id: string }>('/resources/prescriptions', {
      method: 'POST',
      body: JSON.stringify({ patientId: form.patientId, doctorId: form.doctorId, remark: form.remark || undefined }),
    });
    prescriptionId = prescription.id;
    for (const item of items) {
      const created = await apiRequest<{ id: string }>('/resources/prescriptionItems', {
        method: 'POST',
        body: JSON.stringify({ prescriptionId: prescription.id, ...item }),
      });
      createdItemIds.push(created.id);
    }
  } catch (error) {
    // 主记录已创建但明细中途失败：清理孤儿记录（清理失败仅告警，不掩盖原始错误）
    if (prescriptionId) {
      try {
        await cleanupOrphanPrescription(prescriptionId, createdItemIds);
      } catch (cleanupError) {
        console.warn('清理孤儿处方失败', cleanupError);
      }
    }
    throw error;
  }
}

async function updatePrescription(form: PrescriptionForm, prescriptionId: string | null): Promise<void> {
  if (!prescriptionId) throw new Error('处方 ID 缺失');
  await apiRequest(`/resources/prescriptions/${prescriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      patientId: form.patientId,
      doctorId: form.doctorId,
      remark: form.remark || undefined,
      status: form.status,
    }),
  });
  const existing = await fetchAllPages<Record<string, unknown>>(
    `/resources/prescriptionItems?prescriptionId=${prescriptionId}`,
  );
  const existingIds = new Set(existing.map((row) => String(row.id)));
  // 保留的明细（有服务端 id）→ PATCH；新增的明细 → POST（带 prescriptionId）。
  // 与 validItems 同一套有效性过滤，但保留本地 id 用于判断服务端存在性。
  const items = form.items
    .filter((item) => item.name.trim() && item.days && item.quantity && item.price)
    .map((item) => ({ id: item.id, payload: itemPayload(item) }))
    .filter((entry) => entry.payload.days > 0 && entry.payload.quantity > 0 && entry.payload.price >= 0);
  try {
    for (const { id, payload } of items) {
      if (existingIds.has(id)) {
        await apiRequest(`/resources/prescriptionItems/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/resources/prescriptionItems', {
          method: 'POST',
          body: JSON.stringify({ prescriptionId, ...payload, requestId: crypto.randomUUID() }),
        });
      }
    }
    // 表单中已移除的明细 → DELETE
    for (const row of existing) {
      const id = String(row.id);
      if (!form.items.some((item) => item.id === id)) {
        await apiRequest(`/resources/prescriptionItems/${id}`, { method: 'DELETE' });
      }
    }
  } catch (error) {
    throw new Error(`${errorMessage(error, '同步处方明细失败')}；部分明细可能未保存，请核对后重试`);
  }
}

async function processPrescription(
  row: PrescriptionRow,
  reload: () => Promise<unknown>,
  showToast: (message: string, kind?: ToastKind) => void,
): Promise<void> {
  try {
    const result = await apiRequest<PrescriptionProcessResult>(`/prescriptions/${row.id}/process`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast(`已生成划价单 ${result.chargeNumber} 与领药单 ${result.dispenseNumber}`, 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '处理处方失败'), 'error');
  }
}

function PrescriptionStatusDialog({
  row,
  onClose,
  onChanged,
}: {
  row: PrescriptionRow;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const query = useQuery({
    queryKey: ['prescription-status', row.id],
    queryFn: () => apiRequest<PrescriptionStatusResult>(`/prescriptions/${row.id}/status`),
  });

  async function refresh(): Promise<boolean> {
    try {
      await query.refetch();
      await onChanged();
      return true;
    } catch (error) {
      console.warn('刷新处方状态失败:', error);
      return false;
    }
  }

  if (query.isLoading) return <LoadingState label="状态加载中..." />;
  if (query.error) {
    return (
      <>
        <PageError message={query.error.message} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </>
    );
  }
  const status = query.data;
  return (
    <>
      {status && (
        <dl>
          <dt>状态</dt>
          <dd>{statusLabel(status.status)}</dd>
          <dt>处理时间</dt>
          <dd>{formatDateTime(status.processedAt)}</dd>
          <dt>划价单</dt>
          <dd>{status.chargeId ?? '—'}</dd>
          <dt>领药单</dt>
          <dd>{status.dispenseId ?? '—'}</dd>
        </dl>
      )}
      <div className="modal-actions">
        <button
          type="button"
          onClick={async () => {
            const ok = await refresh();
            showToast(ok ? '状态已刷新' : '刷新失败，请稍后重试', ok ? 'success' : 'error');
          }}
        >
          刷新
        </button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </>
  );
}

function PrescriptionForm({ form, update, editing }: { form: PrescriptionForm; update: (patch: Partial<PrescriptionForm>) => void; editing: boolean }) {
  const doctors = useQuery({
    queryKey: ['prescription-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  function updateItem(id: string, patch: Partial<PrescriptionItemForm>) {
    update({ items: form.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      {/* L4：/doctors 加载失败时行内提示并支持重试，避免静默空列表 */}
      {doctors.isError && (
        <div className="query-section-error">
          <p className="error">医生列表加载失败</p>
          <button type="button" onClick={() => void doctors.refetch()}>重试</button>
        </div>
      )}
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })} disabled={doctors.isError}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
      {editing && (
        <label>
          状态
          <select value={form.status} onChange={(event) => update({ status: event.target.value })}>
            {Object.entries(PRESCRIPTION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      )}
      {form.items.map((item) => (
        <div className="prescription-item-row" key={item.id}>
          {ITEM_FIELDS.map((field) => (
            <input
              key={field.key}
              aria-label={field.label}
              placeholder={field.placeholder}
              type={field.type ?? 'text'}
              min={field.min}
              value={item[field.key]}
              onChange={(event) => updateItem(item.id, { [field.key]: event.target.value } as Partial<PrescriptionItemForm>)}
            />
          ))}
          <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" onClick={() => update({ items: [...form.items, newItem()] })}>添加药品</button>
    </>
  );
}

async function cleanupOrphanPrescription(prescriptionId: string, createdItemIds: string[]): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/prescriptionItems/${itemId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`删除处方明细失败（继续清理主记录）：${itemId}`, error);
    }
  }
  try {
    await apiRequest(`/resources/prescriptions/${prescriptionId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(`删除孤儿处方失败：${prescriptionId}`, error);
  }
}

// M9：渲染期写 ref 是反模式（StrictMode 双渲染/对话框切换时 ref 可能指向上一表单实例）。
// 将 ctx.update 赋值移到 effect 提交后执行（子组件 effect 先于父组件回填 effect 运行，
// 保证 editLoadKey 回填能拿到与当前渲染一致的 update）。
function FormUpdateSync({
  update,
  onUpdate,
}: {
  update: (patch: Partial<PrescriptionForm>) => void;
  onUpdate: (update: (patch: Partial<PrescriptionForm>) => void) => void;
}) {
  useEffect(() => {
    onUpdate(update);
  }, [update, onUpdate]);
  return null;
}
