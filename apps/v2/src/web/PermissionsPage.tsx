import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const ROLE_LABELS: Record<string, string> = {
  BOSS: '老板',
  ADMIN: '管理员',
  DOCTOR: '医生',
  RECEPTIONIST: '前台',
  NURSE: '护士',
  TECHNICIAN: '技师',
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
  const [activeRole, setActiveRole] = useState('DOCTOR');
  const [form, setForm] = useState<PermissionForm>(emptyForm);

  const permissions = useQuery({
    queryKey: ['role-permissions', activeRole],
    queryFn: () => apiRequest<Page<PermissionRow>>(`/resources/rolePermissions?role=${activeRole}&page=1&pageSize=200`),
  });

  if (permissions.isLoading) return <LoadingState />;
  if (permissions.error) return <PageError message={(permissions.error as Error).message} />;

  async function toggleAllowed(row: PermissionRow) {
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
  }

  async function addPermission(event: FormEvent) {
    event.preventDefault();
    const resource = form.resource.trim();
    if (!resource) {
      showToast('请填写资源名', 'error');
      return;
    }
    try {
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
      setForm(emptyForm);
      await permissions.refetch();
    } catch (error) {
      showToast(errorMessage(error, '添加失败'), 'error');
    }
  }

  async function removePermission(row: PermissionRow) {
    try {
      await apiRequest(`/resources/rolePermissions/${row.id}`, { method: 'DELETE' });
      showToast('权限已删除', 'success');
      await permissions.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除失败'), 'error');
    }
  }

  const columns = [
    { key: 'resource', label: '资源' },
    { key: 'permission', label: '权限' },
    {
      key: 'allowed',
      label: '允许',
      render: (row: PermissionRow) => (
        <button onClick={() => void toggleAllowed(row)}>{row.allowed ? '允许' : '禁止'}</button>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: PermissionRow) => (
        <button onClick={() => void removePermission(row)}>删除</button>
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

        <h2>新增权限</h2>
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
          <button type="submit">添加权限</button>
        </form>
      </div>
    </div>
  );
}
