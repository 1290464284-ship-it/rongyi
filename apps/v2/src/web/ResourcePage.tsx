import { FormEvent, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { apiRequest, downloadCsv } from './api';
import type { Page, ResourceDefinition, ResourceField } from './types';
import { ConfirmDialog, Dialog, EmptyState, LoadingState, PageError } from './components';
import { formatDisplayValue, centsToYuanString, toCents, toLocalInput } from './format';
import { FormBuilder } from './FormBuilder';
import { friendlyError } from './messages';
import { useDebouncedValue } from './use-debounce';
import { useToast } from './toast-context';

const PROTECTED_UI_FIELDS = new Set([
  'passwordHash',
  'refreshToken',
  'tokenHash',
  'role',
  'loginAttempts',
  'lockedUntil',
  'tokenVersion',
  'balance',
  'totalRecharge',
  'totalConsume',
  'points',
  'totalPoints',
  'stock',
  'minStock',
  'paidAmount',
  'refundedAmount',
]);

const TABLE_COLUMN_LIMIT = 10;

function fieldValue(field: ResourceField, value: unknown): unknown {
  if (field.type === 'json') {
    if (typeof value !== 'string') return JSON.stringify(value ?? '{}');
    return value;
  }
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'datetime' && typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (field.type === 'money') return toCents(value);
  if (field.type === 'number') return Number(value ?? 0);
  return value ?? '';
}

function fieldToForm(field: ResourceField, value: unknown): string | boolean {
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'json') return JSON.stringify(value ?? '', null, 2);
  if (value === null || value === undefined) return '';
  if (field.type === 'datetime' && typeof value === 'string' && value) return toLocalInput(value);
  if (field.type === 'money' && Number.isFinite(Number(value))) return centsToYuanString(value);
  return String(value);
}

export function ResourcePage({ resource: fixedResource }: { resource?: string }) {
  const { showToast } = useToast();
  const params = useParams<{ resource: string }>();
  const resource = fixedResource ?? params.resource ?? 'patients';
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const metaQuery = useQuery({
    queryKey: ['resource-meta'],
    queryFn: () => apiRequest<ResourceDefinition[]>('/resource-meta'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const definition = metaQuery.data?.find((item) => item.name === resource);

  const listQuery = useQuery({
    queryKey: ['resource', resource, debouncedSearch, page],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/${resource}?page=${page}&pageSize=20${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
    ),
    enabled: Boolean(definition),
  });

  const visibleFields = useMemo(
    () => (definition?.fields ?? []).filter((field) => !field.hidden && !PROTECTED_UI_FIELDS.has(field.name)),
    [definition],
  );
  const editableFields = useMemo(
    () => visibleFields.filter((field) => !field.readOnly),
    [visibleFields],
  );
  const tableColumns = useMemo(
    () => visibleFields.slice(0, TABLE_COLUMN_LIMIT).map((field) => ({
      key: field.name,
      label: field.label ?? field.name,
      render: (row: Record<string, unknown>) => formatDisplayValue(row[field.name], field),
    })),
    [visibleFields],
  );

  function openCreate() {
    const initial: Record<string, unknown> = {};
    for (const field of editableFields) {
      if (field.type === 'boolean') initial[field.name] = false;
      else if (field.type === 'json') initial[field.name] = '{}';
    }
    setEditingId(null);
    setForm(initial);
    setShowForm(true);
  }

  function openEdit(row: Record<string, unknown>) {
    const initial: Record<string, unknown> = {};
    for (const field of editableFields) {
      initial[field.name] = fieldToForm(field, row[field.name]);
    }
    setEditingId(String(row.id));
    setForm(initial);
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of editableFields) {
        if (form[field.name] === '' && !field.required) continue;
        payload[field.name] = fieldValue(field, form[field.name]);
      }
      if (editingId) {
        await apiRequest(`/resources/${resource}/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest(`/resources/${resource}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      showToast(editingId ? '更新成功' : '创建成功', 'success');
      await listQuery.refetch();
    } catch (error) {
      const message = friendlyError(error);
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/resources/${resource}/${deleteTarget}`, { method: 'DELETE' });
      setDeleteTarget(null);
      showToast('删除成功', 'success');
      const refreshed = await listQuery.refetch();
      // 删除末页最后一条时回退一页，避免停留在空页
      if (page > 1 && (refreshed.data?.items?.length ?? 0) === 0) {
        setPage((value) => Math.max(1, value - 1));
      }
    } catch (error) {
      const message = friendlyError(error);
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function exportCsv() {
    try {
      await downloadCsv(resource);
      showToast('导出成功', 'success');
    } catch (error) {
      const message = friendlyError(error);
      showToast(message, 'error');
    }
  }

  if (metaQuery.isLoading || listQuery.isLoading) return <LoadingState />;
  if (metaQuery.error || listQuery.error) {
    return (
      <div className="page">
        <PageError message={(metaQuery.error ?? listQuery.error) instanceof Error
          ? ((metaQuery.error ?? listQuery.error) as Error).message
          : '加载失败'} />
        <button onClick={() => {
          void metaQuery.refetch();
          void listQuery.refetch();
        }}>重试</button>
      </div>
    );
  }
  if (!definition) return <PageError message="资源不存在" />;

  const label = definition.label ?? resource;
  const rows = listQuery.data?.items ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>{label}</h1>
        <button onClick={() => void exportCsv()}>导出</button>
        {definition.capabilities.create && <button onClick={openCreate}>新建</button>}
      </div>
      <input
        className="search"
        placeholder="搜索..."
        aria-label="搜索"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {rows.length === 0 ? (
        <EmptyState message="暂无记录" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {tableColumns.map((column) => <th key={column.key}>{column.label}</th>)}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {tableColumns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
                  <td>
                    {definition.capabilities.update && (
                      <button onClick={() => openEdit(row)}>编辑</button>
                    )}
                    {definition.capabilities.delete && (
                      <button className="danger" onClick={() => setDeleteTarget(String(row.id))}>删除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
        <span>第 {page} 页</span>
        <button disabled={!listQuery.data || page * 20 >= listQuery.data.total} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div>

      <Dialog
        open={showForm}
        title={editingId ? `编辑${label}` : `新建${label}`}
        onClose={() => setShowForm(false)}
      >
        <form onSubmit={submit}>
          <FormBuilder
            fields={editableFields}
            values={form}
            onChange={(name, value) => setForm((current) => ({ ...current, [name]: value }))}
          />
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除确认"
        message={`确定删除该${label}记录吗？`}
        confirmText="确认删除"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
