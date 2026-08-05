import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { friendlyError } from './messages';

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
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
