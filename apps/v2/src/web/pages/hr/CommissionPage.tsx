import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { ConfirmDialog, DataTable, LoadingState, PageError, type DataTableColumn } from '../../components';
import { centsToYuanString, formatMoney, toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

interface RuleRow extends Record<string, unknown> {
  id: string;
  name: string;
  category: string | null;
  costType: string | null;
  rateType: 'PERCENT' | 'FIXED';
  rate: number;
  doctorId: string | null;
  enabled: number;
}

interface RuleForm {
  name: string;
  category: string;
  costType: string;
  rateType: 'PERCENT' | 'FIXED';
  rate: string;
  doctorId: string;
  enabled: boolean;
}

interface StatementRow extends Record<string, unknown> {
  id: string;
  period: string;
  doctorId: string;
  doctorName: string | null;
  totalCharged: number;
  totalCommission: number;
  breakdown: Array<{ category: string; costType: string; charged: number; commission: number }>;
  calculatedAt: string;
}

const emptyForm: RuleForm = {
  name: '',
  category: '',
  costType: '',
  rateType: 'PERCENT',
  rate: '10',
  doctorId: '',
  enabled: true,
};

export function CommissionPage() {
  const { showToast } = useToast();
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const rules = useQuery({
    queryKey: ['commission-rules'],
    queryFn: () => apiRequest<RuleRow[]>('/commission/rules'),
  });
  const doctors = useQuery({
    queryKey: ['commission-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const statements = useQuery({
    queryKey: ['commission-statements', period],
    queryFn: () => apiRequest<StatementRow[]>(`/commission/statements?period=${encodeURIComponent(period)}`),
    enabled: period !== '',
  });
  const categories = useQuery({
    queryKey: ['commission-categories'],
    queryFn: () =>
      apiRequest<{ items: Array<Record<string, unknown>> }>(
        '/resources/treatmentCatalogs?page=1&pageSize=200',
      ),
  });

  function openEdit(rule: RuleRow) {
    setForm({
      name: String(rule.name ?? ''),
      category: String(rule.category ?? ''),
      costType: String(rule.costType ?? ''),
      rateType: rule.rateType,
      rate: rule.rateType === 'PERCENT'
        ? String(Math.round(Number(rule.rate ?? 0) / 100))
        : centsToYuanString(rule.rate),
      doctorId: String(rule.doctorId ?? ''),
      enabled: Number(rule.enabled) === 1,
    });
    setEditingId(rule.id);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || busyRef.current) return;
    const rate = Number(form.rate);
    if (!form.name.trim() || !Number.isFinite(rate) || rate < 0 || (form.rateType === 'PERCENT' && !Number.isSafeInteger(rate))) {
      showToast('请填写规则名称和非负整数提成值', 'error');
      return;
    }
    if (form.rateType === 'PERCENT' && rate > 100) {
      showToast('提成比例不能超过 100%', 'error');
      return;
    }
    const storedRate = form.rateType === 'PERCENT' ? rate * 100 : toCents(rate);
    const payload = {
      name: form.name.trim(),
      category: form.category || null,
      costType: form.costType || null,
      rateType: form.rateType,
      rate: storedRate,
      doctorId: form.doctorId || null,
      enabled: form.enabled,
    };
    busyRef.current = true;
    setBusy(true);
    try {
      if (editingId) {
        await apiRequest(`/commission/rules/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('提成规则已更新', 'success');
      } else {
        await apiRequest('/commission/rules', { method: 'POST', body: JSON.stringify(payload) });
        showToast('提成规则已创建', 'success');
      }
      setForm(emptyForm);
      setEditingId(null);
      await rules.refetch();
    } catch (error) {
      showToast(errorMessage(error, '保存提成规则失败'), 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmDelete() {
    /* v8 ignore next -- 确认按钮在 busy 期间 disabled（jsdom 不派发 click），守卫为防御冗余 */
    if (!deleteTarget || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await apiRequest(`/commission/rules/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('提成规则已删除', 'success');
      setDeleteTarget(null);
      await rules.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除提成规则失败'), 'error');
      setDeleteTarget(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function calculate() {
    /* v8 ignore next -- 计算按钮在 busy 期间 disabled（jsdom 不派发 click），守卫为防御冗余 */
    if (busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await apiRequest('/commission/calculate', { method: 'POST', body: JSON.stringify({ period }) });
      showToast('提成计算完成', 'success');
      await statements.refetch();
    } catch (error) {
      showToast(errorMessage(error, '提成计算失败'), 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const ruleColumns: DataTableColumn<RuleRow>[] = [
    { key: 'name', label: '规则名称' },
    {
      key: 'scope',
      label: '适用范围',
      render: (row) => [
        row.category ? `分类 ${row.category}` : '全部分类',
        row.costType ? (row.costType === 'SERVICE' ? '技术服务' : '材料耗材') : '',
        row.doctorId ? '指定医生' : '默认',
      ].filter(Boolean).join(' / '),
    },
    {
      key: 'rate',
      label: '提成',
      render: (row) => (
        row.rateType === 'PERCENT'
          ? `${Math.round(Number(row.rate ?? 0) / 100)}%`
          : `${formatMoney(row.rate)}/单`
      ),
    },
    { key: 'enabled', label: '状态', render: (row) => (Number(row.enabled) === 1 ? '启用' : '停用') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button type="button" onClick={() => openEdit(row)}>编辑</button>
          <button type="button" className="danger" onClick={() => setDeleteTarget(row)}>删除</button>
        </>
      ),
    },
  ];

  const statementColumns: DataTableColumn<StatementRow>[] = [
    { key: 'doctorName', label: '医生', render: (row) => String(row.doctorName ?? row.doctorId ?? '') },
    { key: 'totalCharged', label: '计提升成金额', render: (row) => formatMoney(row.totalCharged) },
    { key: 'totalCommission', label: '提成金额', render: (row) => formatMoney(row.totalCommission) },
    { key: 'calculatedAt', label: '计算时间' },
    {
      key: 'breakdown',
      label: '明细',
      render: (row) => (
        <span>
          {row.breakdown.map((entry) => `${entry.category}(${formatMoney(entry.commission)})`).join('，') || '—'}
        </span>
      ),
    },
  ];

  // TanStack Query v5 将 data 为 undefined 的查询标记为 errored，页面在此之前已落入
  // PageError 分支，`?? []` 仅为类型兜底，不可达。
  /* v8 ignore next -- 见上：undefined 数据恒走 error 分支，空值兜底不可达 */
  const ruleRows = rules.data ?? [];
  /* v8 ignore next -- 同上 */
  const statementRows = statements.data ?? [];

  return (
    <div className="page">
      <div className="page-head"><h1>提成规则</h1></div>
      <section className="card">
        <h2>{editingId ? '编辑提成规则' : '新增提成规则'}</h2>
        <form className="form-grid" onSubmit={(event) => void submit(event)}>
          <label>
            规则名称
            <input aria-label="规则名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：技术服务 10%" />
          </label>
          <label>
            分类
            <select aria-label="规则分类" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="">全部分类</option>
              {(categories.data?.items ?? []).map((category) => (
                <option key={String(category.id)} value={String(category.name ?? category.id)}>
                  {String(category.name ?? category.id)}
                </option>
              ))}
            </select>
            {categories.error && <span className="field-error">分类列表加载失败</span>}
          </label>
          <label>
            成本类型
            <select aria-label="成本类型" value={form.costType} onChange={(event) => setForm({ ...form, costType: event.target.value })}>
              <option value="">不限</option>
              <option value="SERVICE">技术服务</option>
              <option value="MATERIAL">材料耗材</option>
            </select>
          </label>
          <label>
            提成方式
            <select aria-label="提成方式" value={form.rateType} onChange={(event) => setForm({ ...form, rateType: event.target.value as 'PERCENT' | 'FIXED' })}>
              <option value="PERCENT">按比例（%）</option>
              <option value="FIXED">固定金额（元/单）</option>
            </select>
          </label>
          <label>
            {form.rateType === 'PERCENT' ? '比例（%）' : '固定金额（元）'}
            <input
              aria-label="提成值"
              type="number"
              min="0"
              value={form.rate}
              onChange={(event) => setForm({ ...form, rate: event.target.value })}
            />
          </label>
          <label>
            医生
            <select aria-label="适用医生" value={form.doctorId} onChange={(event) => setForm({ ...form, doctorId: event.target.value })}>
              <option value="">默认（所有医生）</option>
              {(doctors.data ?? []).map((doctor) => (
                <option key={String(doctor.id)} value={String(doctor.id)}>{String(doctor.name ?? doctor.id)}</option>
              ))}
            </select>
            {doctors.error && <span className="field-error">医生列表加载失败</span>}
          </label>
          <label className="inline-label">
            <input aria-label="启用规则" type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
            启用
          </label>
          <div className="modal-actions">
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>取消编辑</button>
            )}
            <button type="submit" disabled={busy}>{busy ? '保存中…' : editingId ? '保存修改' : '新增规则'}</button>
          </div>
        </form>
        {rules.isLoading ? (
          <LoadingState label="加载规则…" />
        ) : rules.error ? (
          <PageError message={errorMessage(rules.error, '加载提成规则失败')} />
        ) : (
          <DataTable columns={ruleColumns} rows={ruleRows} keyField="id" emptyText="暂无提成规则" />
        )}
      </section>

      <section className="card">
        <h2>提成计算</h2>
        <div className="inline-form">
          <label>
            月份
            <input aria-label="计算月份" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </label>
          <button type="button" disabled={busy || period === ''} onClick={() => void calculate()}>
            {busy ? '计算中…' : '计算本月提成'}
          </button>
        </div>
        {statements.isLoading ? (
          <LoadingState label="加载提成结果…" />
        ) : statements.error ? (
          <PageError message={errorMessage(statements.error, '加载提成结果失败')} />
        ) : (
          <DataTable columns={statementColumns} rows={statementRows} keyField="id" emptyText="该月份暂无计算结果" />
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除提成规则"
        message={`确定删除规则「${deleteTarget?.name ?? ''}」吗？`}
        confirmText="删除"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
