import { FormEvent, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { apiRequest, downloadCsv } from '../lib/api';
import type { Page, ResourceDefinition } from '../lib/types';
import { DataTable, EmptyState, LoadingState, PageError, PagePager, SearchInput } from '.';
import { formatDisplayValue } from '../lib/format';
import { friendlyError } from '../lib/messages';
import { useDebouncedValue } from '../hooks/use-debounce';
import { useToast } from '../lib/toast-context';
import { PROTECTED_UI_FIELDS, TABLE_COLUMN_LIMIT } from './resource-page-constants';
import { buildInitialForm, buildPayload, formFromRow } from './resource-page-utils';
import { ReadOnlyListPage, type StatColumnType } from './resource-page-readonly';
import { resourceTableColumns } from './resource-page-columns';
import { ResourceFormDialog, DeleteConfirmDialog, BatchDeleteConfirmDialog } from './resource-page-dialogs';

/**
 * 元数据驱动的通用资源 CRUD 页（Round7 M-02 职责说明）。
 * 通过 GET /resources/meta/:resource 读取字段定义（ResourceDefinition），
 * 由 FormBuilder 生成表单、按字段类型渲染表格列，支持搜索/分页/导出。
 * 被 App.tsx 的 `resources/:resource` 路由与 ResourceHub.tsx 使用。
 *
 * 与另外两个通用列表组件如何选型：
 * - ResourcePage：通用资源管理页（元数据驱动，字段随后端 meta 变化）→ 用它；
 * - CrudPage：业务页需要自定义列/行操作/表单体 → 用它；
 * - 只读统计端点表格：本组件 endpoint 只读模式（hub-tabs 的 5 个统计 Tab 专用）。
 * 三者均经 useDebouncedValue（hooks/use-debounce）统一防抖，勿手写 setTimeout。
 */

export type { StatColumnType } from './resource-page-readonly';

export function ResourcePage({ resource, title, endpoint, initialSearch, columnTypes }: {
  resource?: string;
  title?: string;
  endpoint?: string;
  initialSearch?: string;
  /** 只读统计端点的列类型元数据（W-8）：显式声明金额/日期列，避免列名启发式漏判。 */
  columnTypes?: Record<string, StatColumnType>;
}) {
  if (endpoint) return <ReadOnlyListPage title={title ?? '报表'} endpoint={endpoint} columnTypes={columnTypes} />;
  return <ResourceCrudPage resource={resource} initialSearch={initialSearch} />;
}

function ResourceCrudPage({ resource: fixedResource, initialSearch }: { resource?: string; initialSearch?: string }) {
  const { showToast } = useToast();
  const params = useParams<{ resource: string }>();
  const resource = fixedResource ?? params.resource ?? 'patients';
  const [search, setSearch] = useState(initialSearch ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchBusyRef = useRef(false);

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
    placeholderData: (previous) => previous,
    enabled: Boolean(definition),
  });
  const staleRows = listQuery.isPlaceholderData;

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
    setEditingId(null);
    setForm(buildInitialForm(editableFields));
    setShowForm(true);
  }

  function openEdit(row: Record<string, unknown>) {
    /* v8 ignore next -- 编辑按钮在 stale 期间 disabled，浏览器不派发点击，防御分支不可达 */
    if (staleRows) return;
    setEditingId(String(row.id));
    setForm(formFromRow(editableFields, row));
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || submittingRef.current) return;
    if (editingId && staleRows) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = buildPayload(editableFields, form, editingId);
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function remove() {
    const target = deleteTarget;
    /* v8 ignore next -- ConfirmDialog 仅在 deleteTarget 非空时渲染，target 恒存在 */
    if (!target) return;
    /* v8 ignore next -- ConfirmDialog 内部已去重 pending 确认，重复调用不可达 */
    if (submitting || submittingRef.current) return;
    if (staleRows) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await apiRequest(`/resources/${resource}/${target}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(target);
        return next;
      });
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function exportCsv() {
    try {
      if (search) await downloadCsv(resource, search);
      else await downloadCsv(resource);
      showToast('导出成功', 'success');
    } catch (error) {
      const message = friendlyError(error);
      showToast(message, 'error');
    }
  }

  function toggleSelect(id: string, checked: boolean) {
    /* v8 ignore next -- 行复选框在 stale 期间 disabled，onChange 不会触发 */
    if (staleRows) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    /* v8 ignore next -- 全选复选框在 stale 期间 disabled，onChange 不会触发 */
    if (staleRows) return;
    setSelectedIds(new Set(checked ? rows.map((row) => String(row.id)) : []));
  }

  async function confirmBatchDelete() {
    if (batchBusy || batchBusyRef.current || selectedIds.size === 0 || staleRows) return;
    setBatchBusy(true);
    batchBusyRef.current = true;
    try {
      // 并行删除但限制并发（20），并在全部结束后统一汇总：某条失败不影响其余项，
      // 避免大选择集串行等待，也不会一次性打爆连接数。
      const ids = [...selectedIds];
      const BATCH_DELETE_CONCURRENCY = 20;
      const results: PromiseSettledResult<unknown>[] = [];
      for (let offset = 0; offset < ids.length; offset += BATCH_DELETE_CONCURRENCY) {
        const chunk = ids.slice(offset, offset + BATCH_DELETE_CONCURRENCY);
        results.push(...await Promise.allSettled(
          chunk.map((id) => apiRequest(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })),
        ));
      }
      const deleted = results.filter((result) => result.status === 'fulfilled').length;
      const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      const failedIds: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') failedIds.push(ids[index]);
      });
      if (deleted > 0) showToast(`已删除 ${deleted} 项`, 'success');
      if (firstError) showToast(friendlyError(firstError.reason), 'error');
      setSelectedIds(new Set(failedIds));
      setBatchDeleteOpen(failedIds.length > 0);
      await listQuery.refetch();
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  }

  if (metaQuery.isLoading || listQuery.isLoading) return <LoadingState />;
  if (metaQuery.error || listQuery.error) {
    return (
      <div className="page">
        <PageError message={(metaQuery.error ?? listQuery.error) instanceof Error ? ((metaQuery.error ?? listQuery.error) as Error).message : '加载失败'} />
        <button onClick={() => { void metaQuery.refetch(); void listQuery.refetch(); }}>重试</button>
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
        <button disabled={staleRows} onClick={() => void exportCsv()}>导出</button>
        {definition.capabilities.create && <button onClick={openCreate}>新建</button>}
      </div>
      <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); setSelectedIds(new Set()); }} placeholder="搜索..." aria-label="搜索" />
      {selectedIds.size > 0 && (
        <div className="ui-batch-bar">
          <span>已选 {selectedIds.size} 项</span>
          <button className="danger" disabled={batchBusy || staleRows} onClick={() => setBatchDeleteOpen(true)}>删除选中</button>
          <button disabled={batchBusy} onClick={() => setSelectedIds(new Set())}>取消选择</button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState message="暂无记录" />
      ) : (
        <DataTable
          columns={resourceTableColumns({
            tableColumns, canDelete: definition.capabilities.delete, canUpdate: definition.capabilities.update,
            staleRows, selectedIds, rows,
            onToggleSelect: toggleSelect, onToggleSelectAll: toggleSelectAll, onEdit: openEdit,
            onDelete: (row) => setDeleteTarget(String(row.id)),
          })}
          rows={rows} keyField="id" emptyText="暂无记录"
        />
      )}
      <PagePager
        page={page}
        hasNext={Boolean(listQuery.data) && page * 20 < listQuery.data!.total}
        disabled={staleRows}
        onPageChange={(next) => {
          setPage(next);
          setSelectedIds(new Set());
        }}
      />
      <ResourceFormDialog
        open={showForm} title={editingId ? `编辑${label}` : `新建${label}`}
        fields={editableFields} form={form}
        onChange={(name, value) => setForm((current) => ({ ...current, [name]: value }))}
        submitting={submitting} submitDisabled={editingId !== null && staleRows}
        onSubmit={submit} onClose={() => setShowForm(false)}
      />
      <DeleteConfirmDialog open={deleteTarget !== null} message={`确定删除该${label}记录吗？`} onConfirm={() => remove()} onCancel={() => setDeleteTarget(null)} />
      <BatchDeleteConfirmDialog open={batchDeleteOpen} message={`确定删除选中的 ${selectedIds.size} 条${label}记录吗？此操作不可撤销。`} onConfirm={() => void confirmBatchDelete()} onCancel={() => setBatchDeleteOpen(false)} />
    </div>
  );
}
