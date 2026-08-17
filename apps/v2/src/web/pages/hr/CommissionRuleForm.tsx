import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { DoctorRow } from '../../hooks/use-doctors';
import type { RuleForm } from './commission-types';

export function CommissionRuleForm({
  form,
  setForm,
  editingId,
  categories,
  doctors,
  busy,
  onSubmit,
  onCancelEdit,
}: {
  form: RuleForm;
  setForm: Dispatch<SetStateAction<RuleForm>>;
  editingId: string | null;
  categories: UseQueryResult<{ items: Array<Record<string, unknown>> }, Error>;
  doctors: UseQueryResult<DoctorRow[], Error>;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  onCancelEdit: () => void;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
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
          <button type="button" onClick={onCancelEdit}>取消编辑</button>
        )}
        <button type="submit" disabled={busy}>{busy ? '保存中…' : editingId ? '保存修改' : '新增规则'}</button>
      </div>
    </form>
  );
}
