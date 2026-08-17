import type { FormEvent } from 'react';
import { ConfirmDialog, Dialog } from '.';
import { FormBuilder } from './FormBuilder';
import type { ResourceField } from '../lib/types';

/** 新建/编辑表单弹窗（FormBuilder 生成字段）。 */
export function ResourceFormDialog({
  open,
  title,
  fields,
  form,
  onChange,
  submitting,
  submitDisabled,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  fields: ResourceField[];
  form: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  submitting: boolean;
  submitDisabled: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <FormBuilder
          fields={fields}
          values={form}
          onChange={onChange}
        />
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" disabled={submitting || submitDisabled}>{submitting ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** 单条删除确认弹窗。 */
export function DeleteConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="删除确认"
      message={message}
      confirmText="确认删除"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** 批量删除确认弹窗。 */
export function BatchDeleteConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="批量删除确认"
      message={message}
      confirmText="批量删除"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
