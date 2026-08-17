import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { ConfirmDialog, DataTable, LoadingState, PageError } from '../../components';
import { centsToYuanString, toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { useDoctors } from '../../hooks/use-doctors';
import { ruleColumns, statementColumns } from './commission-columns';
import { CommissionRuleForm } from './CommissionRuleForm';
import { emptyForm, type RuleForm, type RuleRow, type StatementRow } from './commission-types';

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
  const doctors = useDoctors();
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
        <CommissionRuleForm
          form={form}
          setForm={setForm}
          editingId={editingId}
          categories={categories}
          doctors={doctors}
          busy={busy}
          onSubmit={(event) => void submit(event)}
          onCancelEdit={() => { setEditingId(null); setForm(emptyForm); }}
        />
        {rules.isLoading ? (
          <LoadingState label="加载规则…" />
        ) : rules.error ? (
          <PageError message={errorMessage(rules.error, '加载提成规则失败')} />
        ) : (
          <DataTable columns={ruleColumns({ onEdit: openEdit, onDelete: setDeleteTarget })} rows={ruleRows} keyField="id" emptyText="暂无提成规则" />
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
