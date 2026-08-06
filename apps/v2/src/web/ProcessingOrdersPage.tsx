import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, SearchableSelect, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

interface ProcessingRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  patientIdLabel?: string | null;
  status?: string | null;
  settleStatus?: string | null;
  settledAmount?: number | null;
  settledAt?: string | null;
  totalFee?: number | null;
}

interface ProcessingItemForm {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

interface ProcessingOrderForm {
  patientId: string;
  doctorId: string;
  number: string;
  shade: string;
  teethNumbers: string;
  totalFee: string;
  items: ProcessingItemForm[];
}

interface SettleStats {
  unsettled: { count: number; feeTotal: number };
  settled: { count: number; amountTotal: number };
}

function newItem(): ProcessingItemForm {
  return { id: crypto.randomUUID(), name: '', quantity: '1', unitPrice: '' };
}

function emptyProcessingForm(): ProcessingOrderForm {
  return { patientId: '', doctorId: '', number: '', shade: '', teethNumbers: '', totalFee: '', items: [newItem()] };
}

interface ValidProcessingItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

function buildValidItems(items: ProcessingItemForm[]): ValidProcessingItem[] {
  return items
    .filter((item) => item.name.trim() && item.quantity && item.unitPrice)
    .map((item) => ({
      name: item.name.trim(),
      quantity: Number(item.quantity),
      unitPrice: toCents(item.unitPrice),
    }))
    .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
}

const processingColumns: DataTableColumn<ProcessingRow>[] = [
  { key: 'number', label: '加工单号' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
  { key: 'settleStatus', label: '结算状态', render: (row) => (row.settleStatus === 'SETTLED' ? '已结算' : '未结算') },
  { key: 'settledAmount', label: '结算金额', render: (row) => (row.settledAmount === null || row.settledAmount === undefined ? '—' : formatMoney(row.settledAmount)) },
];

export function ProcessingOrdersPage() {
  const { showToast } = useToast();
  const [settleTarget, setSettleTarget] = useState<ProcessingRow | null>(null);
  const [settleReload, setSettleReload] = useState<(() => Promise<unknown>) | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleRef, setSettleRef] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settleBusy, setSettleBusy] = useState(false);
  const stats = useQuery({
    queryKey: ['processing-settle-stats'],
    queryFn: () => apiRequest<SettleStats>('/processing-orders/settle-stats'),
  });

  function openSettle(row: ProcessingRow, reload: () => Promise<unknown>) {
    setSettleTarget(row);
    setSettleReload(() => reload);
    setSettleAmount(row.totalFee !== null && row.totalFee !== undefined ? (Number(row.totalFee) / 100).toFixed(2) : '');
    setSettleRef('');
    setSettleNote('');
  }

  function closeSettle() {
    setSettleTarget(null);
    setSettleReload(null);
    setSettleAmount('');
    setSettleRef('');
    setSettleNote('');
  }

  async function submitSettle(event: FormEvent) {
    event.preventDefault();
    if (settleBusy || !settleTarget) return;
    const amount = toCents(settleAmount);
    if (!settleAmount.trim() || !Number.isFinite(amount) || amount < 0) {
      showToast('请输入有效的结算金额', 'error');
      return;
    }
    setSettleBusy(true);
    try {
      await apiRequest(`/processing-orders/${settleTarget.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          ref: settleRef.trim() || undefined,
          note: settleNote.trim() || undefined,
        }),
      });
      showToast('加工单已结算', 'success');
      closeSettle();
      await settleReload?.();
      void stats.refetch();
    } catch (error) {
      showToast(errorMessage(error, '结算失败'), 'error');
    } finally {
      setSettleBusy(false);
    }
  }

  async function unsettleProcessingOrder(row: ProcessingRow, reload: () => Promise<unknown>) {
    try {
      await apiRequest(`/processing-orders/${row.id}/unsettle`, { method: 'POST' });
      showToast('已撤销结算', 'success');
      await reload();
      void stats.refetch();
    } catch (error) {
      showToast(errorMessage(error, '撤销结算失败'), 'error');
    }
  }

  return (
    <>
      {stats.data && (
        <div className="settle-summary">
          <span>未结算 {stats.data.unsettled?.count ?? 0} 单（金额 {formatMoney(stats.data.unsettled?.feeTotal ?? 0)}）</span>
          <span>已结算 {stats.data.settled?.count ?? 0} 单（金额 {formatMoney(stats.data.settled?.amountTotal ?? 0)}）</span>
        </div>
      )}
      <CrudPage<ProcessingRow, ProcessingOrderForm>
        title="加工单管理"
        createLabel="新建加工单"
        emptyMessage="暂无加工单"
        queryKey={['processing-orders']}
        endpoint="/resources/processingOrders"
        initialForm={emptyProcessingForm}
        validate={(form) => {
          const validItems = buildValidItems(form.items);
          if (!form.patientId || !form.number.trim() || validItems.length === 0) {
            return '请选择患者、填写加工单号并至少添加一条有效明细';
          }
          return null;
        }}
        submitOverride={async ({ form }) => {
          const validItems = buildValidItems(form.items);
          const calculatedTotalFee = validItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
          await apiRequest('/processing-orders', {
            method: 'POST',
            body: JSON.stringify({
              patientId: form.patientId,
              doctorId: form.doctorId || undefined,
              number: form.number.trim(),
              shade: form.shade || undefined,
              teethNumbers: splitList(form.teethNumbers),
              totalFee: toCents(form.totalFee) || calculatedTotalFee,
              items: validItems,
              requestId: crypto.randomUUID(),
            }),
          });
        }}
        messages={{ create: '加工单已创建' }}
        errorMessages={{ create: '创建加工单失败' }}
        columns={processingColumns}
        rowActions={(row, ctx) => (
          <>
            <select
              defaultValue=""
              aria-label="变更加工状态"
              onChange={(event) => {
                if (event.target.value) void transitionProcessingOrder(showToast, ctx.reload, row.id, event.target.value);
              }}
            >
              <option value="">变更状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {row.settleStatus === 'SETTLED' ? (
              <button onClick={() => void unsettleProcessingOrder(row, ctx.reload)}>撤销结算</button>
            ) : (
              <button onClick={() => openSettle(row, ctx.reload)}>结算</button>
            )}
          </>
        )}
        renderForm={(ctx) => <ProcessingOrderFormFields form={ctx.form} update={ctx.update} />}
      />
      <Dialog open={settleTarget !== null} title="结算加工单" onClose={closeSettle}>
        <form onSubmit={submitSettle}>
          <label>
            结算金额（元）
            <input type="number" min="0" step="0.01" value={settleAmount} onChange={(event) => setSettleAmount(event.target.value)} />
          </label>
          <label>
            结算单号
            <input value={settleRef} onChange={(event) => setSettleRef(event.target.value)} />
          </label>
          <label>
            备注
            <textarea value={settleNote} onChange={(event) => setSettleNote(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={closeSettle}>取消</button>
            <button type="submit" disabled={settleBusy}>{settleBusy ? '结算中...' : '确认结算'}</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

async function transitionProcessingOrder(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
) {
  try {
    await apiRequest(`/processing-orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('加工单状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  }
}

function ProcessingOrderFormFields({ form, update }: { form: ProcessingOrderForm; update: (patch: Partial<ProcessingOrderForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['processing-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">不指定</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        加工单号
        <input value={form.number} onChange={(event) => update({ number: event.target.value })} />
      </label>
      <label>
        颜色
        <input value={form.shade} onChange={(event) => update({ shade: event.target.value })} />
      </label>
      <label>
        牙位（逗号分隔）
        <input value={form.teethNumbers} onChange={(event) => update({ teethNumbers: event.target.value })} />
      </label>
      <label>
        总费用
        <input type="number" min="0" value={form.totalFee} onChange={(event) => update({ totalFee: event.target.value })} />
      </label>
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <input aria-label="加工项目" value={item.name} placeholder="项目名称" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} />
          <input aria-label="加工数量" type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
          <input aria-label="加工单价" type="number" min="0" value={item.unitPrice} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, unitPrice: event.target.value } : entry) })} />
          <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
    </>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
