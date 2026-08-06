import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { SearchableSelect, type DataTableColumn } from './components';
import { formatMoney, splitList, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  PLANNED: '已计划',
  APPROVED: '已确认',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

interface TreatmentRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  name?: string | null;
  price?: number | null;
  status?: string | null;
}

interface TreatmentForm {
  patientId: string;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  teethNumbers: string;
  status: string;
  plannedDate: string;
  completedDate: string;
  remark: string;
}

const emptyForm: TreatmentForm = {
  patientId: '',
  doctorId: '',
  code: '',
  name: '',
  category: '',
  price: '',
  quantity: '1',
  teethNumbers: '',
  status: 'PLANNED',
  plannedDate: '',
  completedDate: '',
  remark: '',
};

const treatmentColumns: DataTableColumn<TreatmentRow>[] = [
  { key: 'name', label: '治疗项目' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'doctorId', label: '医生', render: (row) => row.doctorIdLabel ?? row.doctorId ?? '' },
  { key: 'price', label: '价格', render: (row) => formatMoney(row.price) },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
];

export function TreatmentsPage() {
  const { showToast } = useToast();
  return (
    <CrudPage<TreatmentRow, TreatmentForm>
      title="治疗管理"
      createLabel="新建治疗"
      emptyMessage="暂无治疗"
      queryKey={['treatments']}
      endpoint="/resources/treatments"
      initialForm={emptyForm}
      validate={(form) => {
        const price = Number(form.price || 0);
        const quantity = Number(form.quantity || 0);
        if (!form.patientId || !form.doctorId || !form.name.trim() || price <= 0 || quantity <= 0) {
          return '请选择患者、医生并填写治疗名称、价格和数量';
        }
        return null;
      }}
      toPayload={(form) => ({
        patientId: form.patientId,
        doctorId: form.doctorId,
        code: form.code || `T-${Date.now()}`,
        name: form.name.trim(),
        category: form.category || 'GENERAL',
        price: toCents(Number(form.price || 0)),
        quantity: Number(form.quantity || 0),
        teethNumbers: splitList(form.teethNumbers),
        status: form.status,
        plannedDate: form.plannedDate || undefined,
        completedDate: form.completedDate || undefined,
        remark: form.remark || undefined,
      })}
      formFromRow={(row) => ({
        patientId: String(row.patientId ?? ''),
        doctorId: String(row.doctorId ?? ''),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
        category: String(row.category ?? 'GENERAL'),
        price: row.price == null ? '' : (Number(row.price) / 100).toFixed(2),
        quantity: String(row.quantity ?? '1'),
        teethNumbers: Array.isArray(row.teethNumbers) ? row.teethNumbers.map(String).join(', ') : '',
        status: String(row.status ?? 'PLANNED'),
        plannedDate: String(row.plannedDate ?? '').slice(0, 10),
        completedDate: String(row.completedDate ?? '').slice(0, 10),
        remark: String(row.remark ?? ''),
      })}
      canEdit
      canDelete
      messages={{ create: '治疗记录已创建', update: '治疗记录已更新', delete: '治疗记录已删除' }}
      errorMessages={{ create: '创建治疗记录失败' }}
      columns={treatmentColumns}
      rowActions={(row, ctx) => (
        <select
          defaultValue=""
          aria-label="变更治疗状态"
          onChange={(event) => {
            if (event.target.value) void transitionTreatment(showToast, ctx.reload, row.id, event.target.value);
          }}
        >
          <option value="">变更状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}
      renderForm={(ctx) => <TreatmentFormFields form={ctx.form} update={ctx.update} />}
    />
  );
}

async function transitionTreatment(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
) {
  try {
    await apiRequest(`/treatments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('治疗状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  }
}

function TreatmentFormFields({ form, update }: { form: TreatmentForm; update: (patch: Partial<TreatmentForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['treatment-doctors'],
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
        项目编码
        <input value={form.code} onChange={(event) => update({ code: event.target.value })} />
      </label>
      <label>
        治疗名称
        <input value={form.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label>
        分类
        <input value={form.category} onChange={(event) => update({ category: event.target.value })} />
      </label>
      <label>
        价格
        <input type="number" min="0" value={form.price} onChange={(event) => update({ price: event.target.value })} />
      </label>
      <label>
        数量
        <input type="number" min="1" value={form.quantity} onChange={(event) => update({ quantity: event.target.value })} />
      </label>
      <label>
        牙位（逗号分隔）
        <input value={form.teethNumbers} onChange={(event) => update({ teethNumbers: event.target.value })} />
      </label>
      <label>
        状态
        <select value={form.status} onChange={(event) => update({ status: event.target.value })}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        计划日期
        <input type="date" value={form.plannedDate} onChange={(event) => update({ plannedDate: event.target.value })} />
      </label>
      <label>
        完成日期
        <input type="date" value={form.completedDate} onChange={(event) => update({ completedDate: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}

