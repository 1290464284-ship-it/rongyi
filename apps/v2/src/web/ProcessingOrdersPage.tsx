import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';
import { toCents } from './format';
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
];

export function ProcessingOrdersPage() {
  const { showToast } = useToast();
  return (
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
      )}
      renderForm={(ctx) => <ProcessingOrderFormFields form={ctx.form} update={ctx.update} />}
    />
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
