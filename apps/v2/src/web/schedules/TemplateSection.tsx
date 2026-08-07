import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { ConfirmDialog, DataTable } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { templateColumns } from './columns';
import { WEEKDAY_LABELS } from './constants';
import { parseWorkDays } from './format';
import type { ShiftTemplate, TemplateForm } from './types';

export function TemplateSection({ templates, reload }: { templates?: ShiftTemplate[]; reload: () => Promise<unknown> }) {
  const { showToast } = useToast();
  const [form, setForm] = useState<TemplateForm>({ name: '', startTime: '', endTime: '', workDays: [1, 2, 3, 4, 5], color: '', active: true });
  const [submitting, setSubmitting] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShiftTemplate | null>(null);
  const update = (patch: Partial<TemplateForm>) => setForm((current) => ({ ...current, ...patch }));

  function openEdit(template: ShiftTemplate) {
    setForm({
      name: String(template.name ?? ''),
      startTime: String(template.startTime ?? ''),
      endTime: String(template.endTime ?? ''),
      workDays: parseWorkDays(template),
      color: String(template.color ?? ''),
      active: Number(template.active) === 1,
    });
    setEditingTemplate(template);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.startTime || !form.endTime || form.workDays.length === 0) {
      showToast('请填写模板名称、时间并至少选择一个工作日', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        workDaysJson: form.workDays,
        color: form.color || undefined,
        active: form.active,
      };
      if (editingTemplate) {
        await apiRequest(`/resources/shiftTemplates/${editingTemplate.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('班次模板已更新', 'success');
      } else {
        await apiRequest('/shift-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('班次模板已创建', 'success');
      }
      setEditingTemplate(null);
      setForm({ name: '', startTime: '', endTime: '', workDays: [1, 2, 3, 4, 5], color: '', active: true });
      await reload();
    } catch (error) {
      showToast(errorMessage(error, editingTemplate ? '更新模板失败' : '创建模板失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteTemplate() {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/resources/shiftTemplates/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('班次模板已删除', 'success');
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      showToast(errorMessage(error, '删除模板失败'), 'error');
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(template: ShiftTemplate) {
    try {
      await apiRequest(`/shift-templates/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: Number(template.active) !== 1 }),
      });
      showToast('模板状态已更新', 'success');
      await reload();
    } catch (error) {
      showToast(errorMessage(error, '更新模板状态失败'), 'error');
    }
  }

  return (
    <section aria-label="班次模板">
      <h2>班次模板</h2>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          模板名称
          <input aria-label="模板名称" value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="如：早班 09:00-18:00" />
        </label>
        <label>
          开始时间
          <input aria-label="开始时间" type="time" value={form.startTime} onChange={(event) => update({ startTime: event.target.value })} />
        </label>
        <label>
          结束时间
          <input aria-label="结束时间" type="time" value={form.endTime} onChange={(event) => update({ endTime: event.target.value })} />
        </label>
        <fieldset className="weekday-fieldset">
          <legend>工作日</legend>
          {WEEKDAY_LABELS.map((label, index) => {
            const day = index + 1;
            return (
              <label key={day} className="weekday-option">
                <input
                  type="checkbox"
                  aria-label={`工作日 ${label}`}
                  checked={form.workDays.includes(day)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...form.workDays, day]
                      : form.workDays.filter((item) => item !== day);
                    update({ workDays: next.sort((a, b) => a - b) });
                  }}
                />
                {label}
              </label>
            );
          })}
        </fieldset>
        <label>
          颜色
          <input aria-label="颜色" type="color" value={form.color || '#4F46E5'} onChange={(event) => update({ color: event.target.value })} />
        </label>
        <label className="inline-label">
          <input aria-label="启用模板" type="checkbox" checked={form.active} onChange={(event) => update({ active: event.target.checked })} />
          启用
        </label>
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : editingTemplate ? '保存模板' : '新增模板'}</button>
      </form>
      <DataTable<ShiftTemplate>
        columns={templateColumns(toggleActive, openEdit, setDeleteTarget)}
        rows={templates ?? []}
        keyField="id"
        emptyText="暂无班次模板"
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除班次模板"
        message={`确定删除模板「${deleteTarget?.name ?? ''}」吗？`}
        confirmText="删除"
        danger
        onConfirm={() => deleteTemplate()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
