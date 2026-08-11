import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { ConfirmDialog, DataTable, Dialog, LoadingState, PageError } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

const FIELD_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT'] as const;

function safeStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

interface CustomFieldRow extends Record<string, unknown> {
  id: string;
  fieldName: string;
  label: string;
  fieldType: string;
  optionsJson?: string;
  required?: boolean;
  sortOrder?: number;
}

interface FieldForm {
  label: string;
  fieldName: string;
  fieldType: string;
  options: string;
  required: boolean;
  sortOrder: string;
}

const emptyForm: FieldForm = {
  label: '',
  fieldName: '',
  fieldType: 'TEXT',
  options: '',
  required: false,
  sortOrder: '0',
};

export function CustomFieldsPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FieldForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldRow | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['custom-fields'],
    queryFn: () => apiRequest<CustomFieldRow[]>('/custom-fields?entity=patient'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const rows = query.data ?? [];

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(row: CustomFieldRow) {
    setEditingId(row.id);
    const options = safeStringArray(row.optionsJson);
    setForm({
      label: row.label,
      fieldName: row.fieldName,
      fieldType: row.fieldType,
      options: options.join('\n'),
      required: Boolean(row.required),
      sortOrder: String(row.sortOrder ?? 0),
    });
    setShowForm(true);
  }

  async function submit() {
    if (busy) return;
    const label = form.label.trim();
    const fieldName = form.fieldName.trim();
    const options = form.options.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!label || !fieldName) {
      showToast('请填写显示名称和字段名', 'error');
      return;
    }
    if (form.fieldType === 'SELECT' && options.length === 0) {
      showToast('SELECT 类型至少需要一个选项', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        label,
        fieldName,
        fieldType: form.fieldType,
        options,
        required: form.required,
        sortOrder: Number(form.sortOrder || 0),
      };
      if (editingId) {
        await apiRequest(`/custom-fields/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiRequest('/custom-fields', { method: 'POST', body: JSON.stringify({ entity: 'patient', ...body }) });
      }
      showToast(editingId ? '字段已更新' : '字段已创建', 'success');
      setShowForm(false);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, editingId ? '更新失败' : '创建失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeField() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/custom-fields/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('字段已删除', 'success');
      setDeleteTarget(null);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'label', label: '显示名称' },
    { key: 'fieldName', label: '字段名' },
    { key: 'fieldType', label: '类型' },
    { key: 'required', label: '必填', render: (row: CustomFieldRow) => (row.required ? '是' : '否') },
    {
      key: 'actions',
      label: '操作',
      render: (row: CustomFieldRow) => (
        <>
          <button onClick={() => openEdit(row)}>编辑</button>
          <button className="danger" onClick={() => setDeleteTarget(row)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>自定义字段</h1>
        <button onClick={openCreate}>新建字段</button>
      </div>
      <DataTable columns={columns} rows={rows} keyField="id" emptyText="暂未配置自定义字段" />

      <Dialog open={showForm} title={editingId ? '编辑字段' : '新建字段'} onClose={() => setShowForm(false)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            显示名称
            <input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} />
          </label>
          <label>
            字段名（字母开头）
            <input value={form.fieldName} onChange={(event) => setForm((current) => ({ ...current, fieldName: event.target.value }))} />
          </label>
          <label>
            类型
            <select
              value={form.fieldType}
              onChange={(event) => setForm((current) => ({ ...current, fieldType: event.target.value }))}
            >
              {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          {form.fieldType === 'SELECT' && (
            <label>
              选项（每行一个）
              <textarea
                value={form.options}
                onChange={(event) => setForm((current) => ({ ...current, options: event.target.value }))}
              />
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={form.required}
              onChange={(event) => setForm((current) => ({ ...current, required: event.target.checked }))}
            />
            必填
          </label>
          <label>
            排序
            <input
              type="number"
              value={form.sortOrder}
              onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
            />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={busy}>{busy ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除字段"
        message={`确定删除字段「${deleteTarget?.label ?? ''}」吗？对应已填写的值也会一并移除。`}
        confirmText="删除"
        danger
        onConfirm={() => void removeField()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
