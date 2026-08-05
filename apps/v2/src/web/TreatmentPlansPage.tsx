import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';

interface PlanRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  name?: string | null;
  totalFee?: number | null;
  status?: string | null;
}

interface PlanItemForm {
  id: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  teethNumbers: string;
  status: string;
}

interface TreatmentPlanForm {
  patientId: string;
  doctorId: string;
  name: string;
  status: string;
  totalFee: string;
  remark: string;
  items: PlanItemForm[];
}

function newItem(): PlanItemForm {
  return { id: crypto.randomUUID(), code: '', name: '', category: '', price: '', quantity: '1', teethNumbers: '', status: 'PLANNED' };
}

function emptyPlanForm(): TreatmentPlanForm {
  return { patientId: '', doctorId: '', name: '', status: 'APPROVED', totalFee: '', remark: '', items: [newItem()] };
}

interface ValidPlanItem {
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  status: string;
}

function buildValidItems(items: PlanItemForm[]): ValidPlanItem[] {
  return items
    .filter((item) => item.name.trim() && item.price && item.quantity)
    .map((item) => ({
      code: item.code || `ITEM-${Date.now()}`,
      name: item.name.trim(),
      category: item.category || 'GENERAL',
      price: toCents(item.price),
      quantity: Number(item.quantity),
      teethNumbers: splitList(item.teethNumbers),
      status: item.status,
    }))
    .filter((item) => item.price > 0 && item.quantity > 0);
}

const planColumns: DataTableColumn<PlanRow>[] = [
  { key: 'name', label: '计划名称' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'totalFee', label: '总费用', render: (row) => formatMoney(row.totalFee) },
  { key: 'status', label: '状态' },
];

export function TreatmentPlansPage() {
  return (
    <CrudPage<PlanRow, TreatmentPlanForm>
      title="治疗计划管理"
      createLabel="新建治疗计划"
      emptyMessage="暂无治疗计划"
      queryKey={['treatment-plans']}
      endpoint="/resources/treatmentPlans"
      initialForm={emptyPlanForm}
      validate={(form) => {
        const validItems = buildValidItems(form.items);
        if (!form.patientId || !form.doctorId || !form.name.trim() || validItems.length === 0) {
          return '请选择患者、医生并填写计划名称和至少一条有效明细';
        }
        return null;
      }}
      submitOverride={async ({ form }) => {
        const validItems = buildValidItems(form.items);
        const calculatedFee = validItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        let planId: string | null = null;
        const createdItemIds: string[] = [];
        try {
          const plan = await apiRequest<{ id: string }>('/resources/treatmentPlans', {
            method: 'POST',
            body: JSON.stringify({
              patientId: form.patientId,
              doctorId: form.doctorId,
              name: form.name.trim(),
              status: form.status,
              totalFee: toCents(form.totalFee) || calculatedFee,
              remark: form.remark || undefined,
            }),
          });
          planId = plan.id;
          for (const item of validItems) {
            const created = await apiRequest<{ id: string }>('/resources/treatmentPlanItems', {
              method: 'POST',
              body: JSON.stringify({ planId: plan.id, ...item }),
            });
            createdItemIds.push(created.id);
          }
        } catch (error) {
          // 主记录已创建但明细中途失败：清理孤儿记录（清理失败仅告警，不掩盖原始错误）
          if (planId) {
            try {
              await cleanupOrphanPlan(planId, createdItemIds);
            } catch (cleanupError) {
              console.warn('清理孤儿治疗计划失败', cleanupError);
            }
          }
          throw error;
        }
      }}
      messages={{ create: '治疗计划已创建' }}
      errorMessages={{ create: '创建治疗计划失败' }}
      columns={planColumns}
      renderForm={(ctx) => <PlanFormFields form={ctx.form} update={ctx.update} />}
    />
  );
}

function PlanFormFields({ form, update }: { form: TreatmentPlanForm; update: (patch: Partial<TreatmentPlanForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['plan-doctors'],
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
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        计划名称
        <input value={form.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label>
        状态
        <input value={form.status} onChange={(event) => update({ status: event.target.value })} />
      </label>
      <label>
        总费用
        <input type="number" min="0" value={form.totalFee} onChange={(event) => update({ totalFee: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <input aria-label="明细名称" value={item.name} placeholder="项目名称" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} />
          <input aria-label="明细编码" value={item.code} placeholder="编码" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, code: event.target.value } : entry) })} />
          <input aria-label="明细单价" type="number" min="0" value={item.price} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, price: event.target.value } : entry) })} />
          <input aria-label="明细数量" type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
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

async function cleanupOrphanPlan(planId: string, createdItemIds: string[]): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/treatmentPlanItems/${itemId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`删除治疗计划明细失败（继续清理主记录）：${itemId}`, error);
    }
  }
  try {
    await apiRequest(`/resources/treatmentPlans/${planId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(`删除孤儿治疗计划失败：${planId}`, error);
  }
}
