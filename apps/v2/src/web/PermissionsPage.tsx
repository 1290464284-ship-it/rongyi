import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { ConfirmDialog, DataTable, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useAsyncAction } from './use-async-action';
import { useToast } from './toast-context';

const ROLE_LABELS: Record<string, string> = {
  BOSS: '老板',
  DOCTOR: '医生',
};

const PERMISSIONS = ['list', 'create', 'update', 'delete'];

type PermissionRow = Record<string, unknown> & {
  id: string;
  role: string;
  resource: string;
  permission: string;
  allowed: boolean;
};

interface PermissionForm {
  resource: string;
  permission: string;
  allowed: boolean;
}

const emptyForm: PermissionForm = {
  resource: '',
  permission: 'list',
  allowed: true,
};

export function PermissionsPage() {
  const { showToast } = useToast();
  const { busy, run } = useAsyncAction();
  const [activeRole, setActiveRole] = useState('DOCTOR');
  const [form, setForm] = useState<PermissionForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PermissionRow | null>(null);

  const permissions = useQuery({
    queryKey: ['role-permissions', activeRole],
    queryFn: () => apiRequest<Page<PermissionRow>>(`/resources/rolePermissions?role=${activeRole}&page=1&pageSize=200`),
  });

  if (permissions.isLoading) return <LoadingState />;
  if (permissions.error) return <PageError message={(permissions.error as Error).message} />;

  function toggleAllowed(row: PermissionRow) {
    void run(async () => {
      try {
        await apiRequest(`/resources/rolePermissions/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ allowed: !row.allowed }),
        });
        showToast('权限已更新', 'success');
        await permissions.refetch();
      } catch (error) {
        showToast(errorMessage(error, '更新失败'), 'error');
      }
    });
  }

  function openEdit(row: PermissionRow) {
    setEditingId(row.id);
    setForm({
      resource: String(row.resource ?? ''),
      permission: String(row.permission ?? 'list'),
      allowed: Boolean(row.allowed),
    });
  }

  function addPermission(event: FormEvent) {
    event.preventDefault();
    const resource = form.resource.trim();
    if (!resource) {
      showToast('请填写资源名', 'error');
      return;
    }
    void run(async () => {
      try {
        if (editingId) {
          await apiRequest(`/resources/rolePermissions/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              resource,
              permission: form.permission,
              allowed: form.allowed,
            }),
          });
          showToast('权限已更新', 'success');
        } else {
          await apiRequest('/resources/rolePermissions', {
            method: 'POST',
            body: JSON.stringify({
              role: activeRole,
              resource,
              permission: form.permission,
              allowed: form.allowed,
            }),
          });
          showToast('权限已添加', 'success');
        }
        setEditingId(null);
        setForm(emptyForm);
        await permissions.refetch();
      } catch (error) {
        showToast(errorMessage(error, editingId ? '更新失败' : '添加失败'), 'error');
      }
    });
  }

  function removePermission(row: PermissionRow) {
    void run(async () => {
      try {
        await apiRequest(`/resources/rolePermissions/${row.id}`, { method: 'DELETE' });
        showToast('权限已删除', 'success');
        await permissions.refetch();
      } catch (error) {
        showToast(errorMessage(error, '删除失败'), 'error');
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  const columns = [
    { key: 'resource', label: '资源' },
    { key: 'permission', label: '权限' },
    {
      key: 'allowed',
      label: '允许',
      render: (row: PermissionRow) => (
        <button disabled={busy} onClick={() => toggleAllowed(row)}>{row.allowed ? '允许' : '禁止'}</button>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: PermissionRow) => (
        <>
          <button disabled={busy} onClick={() => openEdit(row)}>编辑</button>
          <button className="danger" disabled={busy} onClick={() => setDeleteTarget(row)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>权限配置</h1>
      </div>
      <div className="tabs" role="tablist">
        {Object.entries(ROLE_LABELS).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            className={value === activeRole ? 'tab active' : 'tab'}
            onClick={() => setActiveRole(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        <h2>{ROLE_LABELS[activeRole] ?? activeRole}权限</h2>
        <DataTable
          columns={columns}
          rows={permissions.data?.items ?? []}
          keyField="id"
          emptyText="该角色暂无权限配置"
        />

        <h2>{editingId ? '编辑权限' : '新增权限'}</h2>
        <form className="inline-form" onSubmit={addPermission}>
          <input
            value={form.resource}
            placeholder="资源名"
            aria-label="资源名"
            onChange={(event) => setForm((current) => ({ ...current, resource: event.target.value }))}
          />
          <select
            aria-label="权限"
            value={form.permission}
            onChange={(event) => setForm((current) => ({ ...current, permission: event.target.value }))}
          >
            {PERMISSIONS.map((permission) => (
              <option key={permission} value={permission}>{permission}</option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={form.allowed}
              onChange={(event) => setForm((current) => ({ ...current, allowed: event.target.checked }))}
            />
            允许
          </label>
          <button type="submit" disabled={busy}>{editingId ? '保存修改' : '添加权限'}</button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>取消编辑</button>
          )}
        </form>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除确认"
        message={`确定删除资源「${deleteTarget?.resource ?? ''}」的「${deleteTarget?.permission ?? ''}」权限吗？`}
        confirmText="确认删除"
        danger
        onConfirm={() => {
          if (deleteTarget) removePermission(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
