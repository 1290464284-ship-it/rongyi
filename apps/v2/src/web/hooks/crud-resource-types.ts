import type { FormEvent } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Page } from '../lib/types';

export interface CrudListParams {
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
