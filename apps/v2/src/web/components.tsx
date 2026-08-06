import { Component, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { friendlyError } from './messages';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SearchableSelectRow extends Record<string, unknown> {
  id: string;
}

export function SearchableSelect({
  resource,
  labelField = 'name',
  placeholder = '选择',
  value,
  onChange,
  ariaLabel,
  filterParams,
  pageSize = 100,
  onLoaded,
}: {
  resource: string;
  labelField?: string;
  placeholder?: string;
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  filterParams?: Record<string, string>;
  pageSize?: number;
  onLoaded?: (rows: SearchableSelectRow[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // 已加载并去重的条目：搜索变化时清空，加载更多时按 id 追加合并。
  const [loaded, setLoaded] = useState<SearchableSelectRow[]>([]);

  const query = useQuery({
    queryKey: ['searchable-select', resource, search, page, filterParams],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const trimmed = search.trim();
      if (trimmed !== '') params.set('search', trimmed);
      if (filterParams) {
        for (const [key, value] of Object.entries(filterParams)) {
          if (value !== undefined && value !== null && value !== '') params.set(key, value);
        }
      }
      return apiRequest<Page<SearchableSelectRow>>(`/resources/${resource}?${params.toString()}`);
    },
  });

  useEffect(() => {
    const items = query.data?.items ?? [];
    if (items.length === 0) return;
    setLoaded((current) => {
      const byId = new Map<string, SearchableSelectRow>();
      for (const row of current) byId.set(String(row.id), row);
      for (const row of items) byId.set(String(row.id), row);
      return Array.from(byId.values());
    });
  }, [query.data]);

  useEffect(() => {
    if (query.data) onLoaded?.(loaded);
  }, [loaded, query.data]);

  const total = query.data?.total ?? 0;
  const hasMore = total > loaded.length;
  const selectedMissing = value !== '' && !loaded.some((row) => String(row.id) === value);

  return (
    <span className="searchable-select">
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {selectedMissing && <option value={value}>{value}</option>}
        {loaded.map((row) => (
          <option key={String(row.id)} value={String(row.id)}>
            {String(row[labelField] ?? row.id)}
          </option>
        ))}
      </select>
      <input
        aria-label={`${ariaLabel}搜索`}
        placeholder="搜索…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
          setLoaded([]);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {hasMore && (
        <button type="button" disabled={query.isFetching} onClick={() => setPage((current) => current + 1)}>
          加载更多（已加载 {loaded.length} 条）
        </button>
      )}
      {query.error && <span className="error">{friendlyError(query.error)}</span>}
    </span>
  );
}

export interface DataTableColumn<T extends Record<string, unknown>> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  keyField,
  emptyText = '暂无数据',
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyField?: keyof T;
  emptyText?: string;
}) {
  if (rows.length === 0) return <div className="table-empty">{emptyText}</div>;
  const tableContent = (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} style={rows.length > 100 ? { position: 'sticky', top: 0, zIndex: 1 } : undefined}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={keyField ? String(row[keyField] ?? '') : index}>
            {columns.map((column) => (
              <td key={column.key}>
                {column.render ? column.render(row) : String(row[column.key] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="table-wrap">
      {rows.length > 100 ? (
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {tableContent}
        </div>
      ) : tableContent}
    </div>
  );
}

export function PageError({ message }: { message: string }) {
  return <p className="error">{friendlyError(message)}</p>;
}

export function LoadingState({ label = '加载中...' }: { label?: string }) {
  return <div className="page-state">{label}</div>;
}

export function EmptyState({ message = '暂无数据' }: { message?: string }) {
  return <div className="table-empty">{message}</div>;
}

export function QueryBoundary({
  isLoading,
  error,
  data,
  loadingLabel,
  errorLabel,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  data?: unknown;
  loadingLabel?: string;
  errorLabel?: string;
  children: ReactNode;
}) {
  if (isLoading) return <LoadingState label={loadingLabel} />;
  if (error) return <PageError message={errorLabel ?? (error instanceof Error ? error.message : String(error))} />;
  if (data === undefined) return <PageError message={errorLabel ?? '数据加载失败'} />;
  return <>{children}</>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page error-state">
          <h1>页面加载失败</h1>
          <p>{friendlyError(this.state.error.message)}</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // 打开时记录触发元素并把焦点移入弹窗；关闭/卸载时还原焦点
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    if (modal) {
      const firstFocusable = modal.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? modal).focus();
    }
    return () => {
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    // 焦点陷阱：Tab/Shift+Tab 在弹窗内循环，焦点逃逸到弹窗外时拉回第一个可聚焦元素
    const modal = modalRef.current;
    if (!modal) return;
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-head">
          <h2>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>{cancelText}</button>
        <button type="button" className={danger ? 'danger' : undefined} onClick={onConfirm}>{confirmText}</button>
      </div>
    </Dialog>
  );
}

export function PromptDialog({
  open,
  title = '请输入',
  message,
  value = '',
  inputType = 'text',
  placeholder = '',
  confirmText = '确认',
  cancelText = '取消',
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message?: string;
  value?: string;
  inputType?: 'text' | 'number' | 'textarea';
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState(value);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(current);
  }

  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <form onSubmit={submit}>
        {message && <p>{message}</p>}
        {inputType === 'textarea' ? (
          <textarea value={current} onChange={(event) => setCurrent(event.target.value)} placeholder={placeholder} />
        ) : (
          <input
            autoFocus
            type={inputType === 'number' ? 'number' : 'text'}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            placeholder={placeholder}
          />
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>{cancelText}</button>
          <button type="submit">{confirmText}</button>
        </div>
      </form>
    </Dialog>
  );
}
