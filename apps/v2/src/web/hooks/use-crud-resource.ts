import { useRef, useState, type FormEvent } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import type { Page } from '../lib/types';
import { useDebouncedValue } from './use-debounce';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';

interface CrudListParams {
  page: number;
  search: string;
}

export interface CrudResourceOptions<
  TRow extends Record<string, unknown>,
  TForm extends object,
> {
  /** 列表查询键（如 ['visits']），内部追加 page/search 维度。 */
  queryKey: unknown[];
  /** 资源端点（如 '/resources/visits'），作为 POST/PATCH/DELETE 基址。 */
  endpoint: string;
  /** 列表路径；默认 `${endpoint}?page=${page}&pageSize=${pageSize}${search ? '&search=...' : ''}`。 */
  listPath?: string | ((params: CrudListParams) => string);
  /** 分页大小，默认 50。 */
  pageSize?: number;
  /** keyset cursor pagination for large tables (server returns nextCursor). */
  cursorPagination?: boolean;
  /** 透传给列表 useQuery。 */
  enabled?: boolean;
  /** 初始搜索词（如顶栏全局搜索以 ?q= 跳转带入）。 */
  initialSearch?: string;
  /** 新建/创建成功后的初始表单。 */
  initialForm: TForm | (() => TForm);
  /** 编辑回填；缺省按 initialForm 的键复制 row 同名字段。 */
  formFromRow?: (row: TRow) => TForm;
  /** 客户端校验；返回错误文案即拦截（toast error 并 return）。 */
  validate?: (form: TForm) => string | null;
  /** 提交 payload 转换（如空可选字段转 undefined、datetime 转 ISO、金额 toCents）；缺省 {...form}。 */
  toPayload?: (form: TForm, editing: boolean) => Record<string, unknown>;
  /** 是否渲染/支持编辑（PATCH）。默认 false。 */
  canEdit?: boolean;
  /** 是否渲染/支持删除（DELETE + 确认）。默认 false。 */
  canDelete?: boolean;
  /** 成功 toast 文案。默认：创建成功/更新成功/删除成功。 */
  messages?: { create?: string; update?: string; delete?: string };
  /** 失败 toast 兜底文案（经 errorMessage() 合并原始错误信息）。默认：创建失败/更新失败/删除失败。 */
  errorMessages?: { create?: string; update?: string; delete?: string };
  /** 异步前置校验（如提交前查重）；返回错误文案即拦截。 */
  onBeforeSubmit?: (form: TForm, editing: boolean) => Promise<string | null>;
  /**
   * 自定义提交（如主子表多请求创建）。抛错由 hook 统一 toast（errorMessages.create/update），
   * 成功由 hook 统一关闭表单、重置表单、刷新列表。页面特有逻辑（如孤儿清理）留在页面内。
   */
  submitOverride?: (ctx: { form: TForm; editing: boolean }) => Promise<void>;
  /** 自定义删除（如主子表先删子记录再删主记录）。抛错由 hook 统一 toast（errorMessages.delete）。 */
  deleteOverride?: (row: TRow) => Promise<void>;
  /** 创建成功后、关闭/重置表单前回调。 */
  onAfterCreate?: (form: TForm) => void;
  /** 保存成功后回调，携带记录 id（新建时来自创建接口返回）。 */
  onSaved?: (id: string | null, editing: boolean, form: TForm) => Promise<void> | void;
}

export interface CrudResourceResult<
  TRow extends Record<string, unknown>,
  TForm extends object,
> {
  query: UseQueryResult<Page<TRow>>;
  /** 列表当前展示的是旧数据占位（新查询键加载中），行写操作应禁用。 */
  isStale: boolean;
  rows: TRow[];
  reload: () => Promise<unknown>;
  /** 防抖后的搜索词（查询用）。 */
  search: string;
  /** 输入框即时值（未防抖），供受控输入框绑定，避免输入滞后。 */
  searchInput: string;
  setSearch: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  hasNext: boolean;
  canGoPrev: boolean;
  goNext: () => void;
  goPrev: () => void;
  cursorPagination: boolean;
  showForm: boolean;
  editing: boolean;
  editingId: string | null;
  form: TForm;
  updateForm: (patch: Partial<TForm>) => void;
  openCreate: () => void;
  openEdit: (row: TRow) => void;
  closeForm: () => void;
  submit: (event?: FormEvent) => Promise<void>;
  submitting: boolean;
  deleteTarget: TRow | null;
  requestDelete: (row: TRow) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
}

const DEFAULT_MESSAGES = { create: '创建成功', update: '更新成功', delete: '删除成功' };
const DEFAULT_ERROR_MESSAGES = { create: '创建失败', update: '更新失败', delete: '删除失败' };

export function useCrudResource<
  TRow extends Record<string, unknown> = Record<string, unknown>,
  TForm extends object = Record<string, unknown>,
>(options: CrudResourceOptions<TRow, TForm>): CrudResourceResult<TRow, TForm> {
  const { showToast } = useToast();
  const [searchInput, setSearchInput] = useState(options.initialSearch ?? '');
  // M4：initialSearch（如顶栏全局搜索 ?q=）变化时同步搜索词，调用方不再用 key 整页重挂载。
  // 采用 React 官方"渲染期调整 state"模式（避免 set-state-in-effect 级联渲染）。
  const [prevInitialSearch, setPrevInitialSearch] = useState(options.initialSearch);
  const search = useDebouncedValue(searchInput, 300);
  const [page, setPage] = useState(1);
  const cursorPagination = options.cursorPagination === true;
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  if (options.initialSearch !== prevInitialSearch) {
    setPrevInitialSearch(options.initialSearch);
    setSearchInput(options.initialSearch ?? '');
    // 全局搜索带 ?q= 跳转时回到第一页，避免停留在旧页导致空结果。
    setPage(1);
    if (cursorPagination) {
      setCursor(null);
      setCursorStack([]);
    }
  }
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TForm>(() => freshInitial(options.initialForm));
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TRow | null>(null);
  // ref 级 in-flight 守卫：setState 是异步的，onBeforeSubmit 查重期间双击会漏进第二个请求
  const submittingRef = useRef(false);

  const pageSize = options.pageSize ?? 50;
  const staticListPath = typeof options.listPath === 'function' ? undefined : options.listPath;
  const resolveListPath: (params: CrudListParams) => string = typeof options.listPath === 'function'
    ? options.listPath
    : (params: CrudListParams) => staticListPath ?? buildDefaultListPath(options.endpoint, pageSize, params);

  const query = useQuery({
    queryKey: cursorPagination ? [...options.queryKey, search, cursor ?? ''] : [...options.queryKey, page, search],
    queryFn: () => apiRequest<Page<TRow>>(
      cursorPagination ? resolveCursorListPath(resolveListPath, search, cursor) : resolveListPath({ page, search }),
    ),
    enabled: options.enabled,
    placeholderData: (previous) => previous,
  });

  function setSearch(value: string) {
    setSearchInput(value);
    setPage(1);
    if (cursorPagination) {
      setCursor(null);
      setCursorStack([]);
    }
  }

  function goNext() {
    if (query.isPlaceholderData) return;
    const next = query.data?.nextCursor;
    if (!next) return;
    setCursorStack((current) => [...current, cursor ?? '']);
    setCursor(next);
  }

  function goPrev() {
    if (query.isPlaceholderData) return;
    if (cursorStack.length === 0) return;
    const nextStack = [...cursorStack];
    const previous = nextStack.pop() ?? null;
    setCursorStack(nextStack);
    setCursor(previous);
  }

  function handleSetPage(value: number) {
    if (!cursorPagination) {
      setPage(value);
      return;
    }
    const current = cursorStack.length + 1;
    if (value > current) goNext();
    else if (value < current) goPrev();
  }

  function updateForm(patch: Partial<TForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(freshInitial(options.initialForm));
    setShowForm(true);
  }

  function openEdit(row: TRow) {
    if (query.isPlaceholderData) return;
    setEditingId(String(row.id));
    setForm(options.formFromRow ? options.formFromRow(row) : pickFormFromRow(options.initialForm, row));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (submitting || submittingRef.current) return;
    // 编辑弹窗已打开时列表进入 placeholder：旧记录仍可 PATCH，必须拦截。
    if (editingId !== null && query.isPlaceholderData) return;
    submittingRef.current = true;
    setSubmitting(true);
    const editing = editingId !== null;
    try {
      if (options.validate) {
        const error = options.validate(form);
        if (error) {
          showToast(error, 'error');
          return;
        }
      }
      if (options.onBeforeSubmit) {
        const error = await options.onBeforeSubmit(form, editing);
        if (error) {
          showToast(error, 'error');
          return;
        }
      }
      let savedId: string | null = editingId;
      if (options.submitOverride) {
        await options.submitOverride({ form, editing });
      } else {
        const payload = options.toPayload ? options.toPayload(form, editing) : { ...form };
        if (editingId) {
          await apiRequest(`${options.endpoint}/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
        } else {
          const created = await apiRequest<{ id?: string }>(options.endpoint, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          savedId = created?.id ?? null;
        }
      }
      // 契约：onAfterCreate 仅在创建成功后回调（编辑路径不触发）
      if (!editing) options.onAfterCreate?.(form);
      await options.onSaved?.(savedId, editing, form);
      const message = editing ? options.messages?.update ?? DEFAULT_MESSAGES.update : options.messages?.create ?? DEFAULT_MESSAGES.create;
      showToast(message, 'success');
      setShowForm(false);
      setForm(freshInitial(options.initialForm));
      await query.refetch();
    } catch (error) {
      const fallback = editing
        ? options.errorMessages?.update ?? DEFAULT_ERROR_MESSAGES.update
        : options.errorMessages?.create ?? DEFAULT_ERROR_MESSAGES.create;
      showToast(errorMessage(error, fallback), 'error');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function requestDelete(row: TRow) {
    if (query.isPlaceholderData) return;
    setDeleteTarget(row);
  }

  function cancelDelete() {
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || submitting || submittingRef.current || query.isPlaceholderData) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (options.deleteOverride) {
        await options.deleteOverride(deleteTarget);
      } else {
        await apiRequest(`${options.endpoint}/${String(deleteTarget.id)}`, { method: 'DELETE' });
      }
      setDeleteTarget(null);
      showToast(options.messages?.delete ?? DEFAULT_MESSAGES.delete, 'success');
      const refreshed = await query.refetch();
      // 删除末页最后一条时回退一页，避免停留在空页
      if (cursorPagination) {
        if ((refreshed.data?.items?.length ?? 0) === 0 && cursorStack.length > 0) goPrev();
      } else if (page > 1 && (refreshed.data?.items?.length ?? 0) === 0) {
        setPage(page - 1);
      }
    } catch (error) {
      showToast(errorMessage(error, options.errorMessages?.delete ?? DEFAULT_ERROR_MESSAGES.delete), 'error');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return {
    query,
    isStale: query.isPlaceholderData,
    rows: query.data?.items ?? [],
    reload: () => query.refetch(),
    search,
    searchInput,
    setSearch,
    page: cursorPagination ? cursorStack.length + 1 : page,
    setPage: handleSetPage,
    hasNext: cursorPagination ? Boolean(query.data?.nextCursor) : page * pageSize < (query.data?.total ?? 0),
    canGoPrev: cursorPagination ? cursorStack.length > 0 : page > 1,
    goNext,
    goPrev,
    cursorPagination,
    showForm,
    editing: editingId !== null,
    editingId,
    form,
    updateForm,
    openCreate,
    openEdit,
    closeForm,
    submit,
    submitting,
    deleteTarget,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}

function freshInitial<TForm extends object>(initialForm: TForm | (() => TForm)): TForm {
  return typeof initialForm === 'function' ? initialForm() : { ...initialForm };
}

function pickFormFromRow<TForm extends object, TRow extends Record<string, unknown>>(
  initialForm: TForm | (() => TForm),
  row: TRow,
): TForm {
  const base = freshInitial(initialForm);
  const form = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const value = row[key];
    if (value !== undefined) form[key] = value;
  }
  return form as TForm;
}

function buildDefaultListPath(endpoint: string, pageSize: number, params: CrudListParams): string {
  const query = `page=${params.page}&pageSize=${pageSize}`;
  const searchPart = params.search ? `&search=${encodeURIComponent(params.search)}` : '';
  return `${endpoint}?${query}${searchPart}`;
}

function resolveCursorListPath(
  resolve: (params: CrudListParams) => string,
  search: string,
  cursor: string | null,
): string {
  const base = resolve({ page: 1, search });
  if (!cursor) return base;
  const [pathPart, queryPart = ''] = base.split('?', 2);
  const params = new URLSearchParams(queryPart);
  params.set('cursor', cursor);
  return `${pathPart}?${params.toString()}`;
}
