import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { ConfirmDialog, DataTable, LoadingState, type DataTableColumn } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// WorkSchedule.weekDay 采用 JS Date.getDay() 约定：0=周日 … 6=周六
const WEEKDAY_JS_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface ShiftTemplate extends Record<string, unknown> {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workDaysJson: string | null;
  workDays?: number[];
  color: string | null;
  active: number;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  name?: string | null;
  username?: string | null;
  role?: string | null;
}

interface WeekScheduleRow extends Record<string, unknown> {
  id: string;
  userId: string;
  userIdLabel: string;
  title: string | null;
  color: string | null;
  weekDay: number;
  startTime: string;
  endTime: string;
  type: string;
  date: string;
}

interface GenerateResult {
  created: number;
  skipped: number;
  weekStart: string;
}

const TYPE_LABELS: Record<string, string> = { FIXED: '固定排班' };

export function SchedulesPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

  const templatesQuery = useQuery({
    queryKey: ['shift-templates'],
    queryFn: () => apiRequest<ShiftTemplate[]>('/shift-templates'),
  });
  const usersQuery = useQuery({
    queryKey: ['schedule-users'],
    queryFn: () => apiRequest<{ items: UserRow[] }>('/resources/users?page=1&pageSize=100'),
  });
  const weekQuery = useQuery({
    queryKey: ['schedules-week', weekStart],
    queryFn: () => apiRequest<WeekScheduleRow[]>(`/schedules/week?weekStart=${weekStart}`),
  });

  const reloadTemplates = () => queryClient.invalidateQueries({ queryKey: ['shift-templates'] });
  const reloadWeek = () => queryClient.invalidateQueries({ queryKey: ['schedules-week'] });

  return (
    <div className="page">
      <h1>排班中心</h1>
      <TemplateSection templates={templatesQuery.data} reload={reloadTemplates} />
      <GenerateSection
        templates={templatesQuery.data}
        users={usersQuery.data?.items}
        weekStart={weekStart}
        onWeekStartChange={setWeekStart}
        onGenerated={reloadWeek}
      />
      <h2>本周排班（{formatWeekRange(weekStart)}）</h2>
      {weekQuery.isLoading ? <LoadingState /> : weekQuery.error ? <p className="error">{errorMessage(weekQuery.error)}</p> : (
        <DataTable<WeekScheduleRow>
          columns={weekColumns}
          rows={weekQuery.data ?? []}
          keyField="id"
          emptyText="本周暂无排班"
        />
      )}
    </div>
  );
}

function TemplateSection({ templates, reload }: { templates?: ShiftTemplate[]; reload: () => Promise<unknown> }) {
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
        onConfirm={() => void deleteTemplate()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

interface TemplateForm {
  name: string;
  startTime: string;
  endTime: string;
  workDays: number[];
  color: string;
  active: boolean;
}

function GenerateSection({
  templates,
  users,
  weekStart,
  onWeekStartChange,
  onGenerated,
}: {
  templates?: ShiftTemplate[];
  users?: UserRow[];
  weekStart: string;
  onWeekStartChange: (value: string) => void;
  onGenerated: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [templateId, setTemplateId] = useState('');
  const [userId, setUserId] = useState('');
  const [generating, setGenerating] = useState(false);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!templateId || !userId || !weekStart) {
      showToast('请选择用户、模板和周', 'error');
      return;
    }
    setGenerating(true);
    try {
      const result = await apiRequest<GenerateResult>('/shift-templates/generate', {
        method: 'POST',
        body: JSON.stringify({ templateId, userId, weekStart }),
      });
      showToast(`已生成 ${result.created} 条固定排班${result.skipped > 0 ? `，跳过 ${result.skipped} 条已存在` : ''}`, 'success');
      await onGenerated();
    } catch (error) {
      showToast(errorMessage(error, '生成排班失败'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section aria-label="固定排班">
      <h2>固定排班</h2>
      <form className="form-grid" onSubmit={handleGenerate}>
        <label>
          用户
          <select aria-label="选择用户" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">选择用户</option>
            {(users ?? []).map((user) => (
              <option key={user.id} value={user.id}>{user.name ?? user.username ?? user.id}</option>
            ))}
          </select>
        </label>
        <label>
          排班模板
          <select aria-label="选择模板" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">选择模板</option>
            {(templates ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}（{formatWorkDays(template.workDays ?? [])} {template.startTime}-{template.endTime}）
              </option>
            ))}
          </select>
        </label>
        <label>
          周（自动取所在周的周一）
          <input aria-label="选择周" type="date" value={weekStart} onChange={(event) => {
            const picked = event.target.value;
            onWeekStartChange(picked ? mondayOf(new Date(`${picked}T00:00:00`)) : mondayOf(new Date()));
          }} />
        </label>
        <button type="submit" disabled={generating}>{generating ? '生成中...' : '生成固定排班'}</button>
      </form>
    </section>
  );
}

function templateColumns(
  toggleActive: (template: ShiftTemplate) => void,
  openEdit: (template: ShiftTemplate) => void,
  requestDelete: (template: ShiftTemplate) => void,
): DataTableColumn<ShiftTemplate>[] {
  return [
    { key: 'name', label: '名称' },
    { key: 'startTime', label: '时间', render: (row) => `${row.startTime} - ${row.endTime}` },
    { key: 'workDays', label: '工作日', render: (row) => formatWorkDays(row.workDays ?? []) },
    { key: 'active', label: '状态', render: (row) => (Number(row.active) === 1 ? '启用' : '停用') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button onClick={() => void toggleActive(row)}>{Number(row.active) === 1 ? '停用' : '启用'}</button>
          <button onClick={() => openEdit(row)}>编辑</button>
          <button className="danger" onClick={() => requestDelete(row)}>删除</button>
        </>
      ),
    },
  ];
}

/** 解析模板工作日（优先 workDaysJson 数组，兼容行内已展开的 workDays）。 */
function parseWorkDays(template: ShiftTemplate): number[] {
  const raw = template.workDaysJson ?? template.workDays;
  if (Array.isArray(raw)) return raw.map(Number).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
    } catch {
      // fall through
    }
  }
  return [1, 2, 3, 4, 5];
}

const weekColumns: DataTableColumn<WeekScheduleRow>[] = [
  { key: 'date', label: '日期', render: (row) => `${row.date}（${WEEKDAY_JS_LABELS[row.weekDay] ?? ''}）` },
  { key: 'userId', label: '用户', render: (row) => row.userIdLabel ?? row.userId },
  { key: 'title', label: '班次标题', render: (row) => row.title ?? '—' },
  { key: 'startTime', label: '时间', render: (row) => `${row.startTime.slice(11, 16)} - ${row.endTime.slice(11, 16)}` },
  { key: 'type', label: '类型', render: (row) => TYPE_LABELS[row.type] ?? row.type },
];

/** workDays（1=周一 … 7=周日）显示为「周一~周五」等可读形式。 */
function formatWorkDays(workDays: number[]): string {
  const days = [...workDays].sort((a, b) => a - b);
  if (days.length === 0) return '未设置';
  const parts: string[] = [];
  let start = days[0];
  let prev = days[0];
  for (let index = 1; index <= days.length; index += 1) {
    const current = days[index];
    if (current === undefined || current !== prev + 1) {
      parts.push(start === prev ? WEEKDAY_LABELS[start - 1] : `${WEEKDAY_LABELS[start - 1]}~${WEEKDAY_LABELS[prev - 1]}`);
      if (current !== undefined) start = current;
    }
    prev = current ?? prev;
  }
  return parts.join('、');
}

function formatWeekRange(weekStart: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!match) return weekStart;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 6);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${weekStart} ~ ${year}-${month}-${day}`;
}

function mondayOf(date: Date): string {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}
