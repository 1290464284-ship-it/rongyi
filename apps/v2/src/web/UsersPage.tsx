import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import {
  ConfirmDialog,
  DataTable,
  Dialog,
  LoadingState,
  PageError,
  PromptDialog,
} from './components';
import { formatDisplayValue } from './format';
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

type UserRow = Record<string, unknown> & {
  id: string;
  username: string;
  name: string;
  role: string;
  phone?: string | null;
  active: boolean;
};

interface UserRoleRow {
  userId: string;
  role: string;
}

interface UserForm {
  username: string;
  password: string;
  name: string;
  role: string;
  phone: string;
  active: boolean;
}

const emptyForm: UserForm = {
  username: '',
  password: '',
  name: '',
  role: 'DOCTOR',
  phone: '',
  active: true,
};

export function UsersPage() {
  const { showToast } = useToast();
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [additionalRoles, setAdditionalRoles] = useState<string[]>([]);

  const me = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => apiRequest<{ role?: string }>('/auth/me'),
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiRequest<Page<UserRow>>('/resources/users?page=1&pageSize=100'),
    enabled: me.data?.role === 'BOSS',
  });
  const userRoles = useQuery({
    queryKey: ['user-roles'],
    queryFn: () => apiRequest<{ items: UserRoleRow[] }>('/user-roles'),
    enabled: me.data?.role === 'BOSS',
  });

  if (me.isLoading) return <LoadingState />;
  if (me.error || me.data?.role !== 'BOSS') {
    return <PageError message="仅老板可管理员工账号" />;
  }
  if (users.isLoading) return <LoadingState />;
  if (users.error) return <PageError message={(users.error as Error).message} />;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setAdditionalRoles([]);
    setShowForm(true);
  }

  function openEdit(row: UserRow) {
    setEditingId(row.id);
    setForm({
      username: row.username,
      password: '',
      name: row.name,
      role: row.role,
      phone: row.phone ?? '',
      active: Boolean(row.active),
    });
    setAdditionalRoles((userRoles.data?.items ?? [])
      .filter((entry) => entry.userId === row.id)
      .map((entry) => entry.role));
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      let targetId = editingId;
      if (editingId) {
        await apiRequest(`/admin/users/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name,
            phone: form.phone || undefined,
            role: form.role,
            active: form.active,
          }),
        });
      } else {
        const created = await apiRequest<{ id: string }>('/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            username: form.username,
            password: form.password,
            name: form.name,
            role: form.role,
            phone: form.phone || undefined,
            active: form.active,
          }),
        });
        targetId = created.id;
      }
      if (targetId) {
        await apiRequest(`/user-roles/${targetId}`, {
          method: 'PUT',
          body: JSON.stringify({ roles: additionalRoles }),
        });
      }
      showToast(editingId ? '员工资料已更新' : '员工已创建', 'success');
      setShowForm(false);
      await users.refetch();
      await userRoles.refetch();
    } catch (error) {
      showToast(errorMessage(error, '保存失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteUser() {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/admin/users/${deleteTarget.id}`, { method: 'DELETE' });
      showToast('员工已删除', 'success');
      setDeleteTarget(null);
      await users.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除失败'), 'error');
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword(password: string) {
    if (!passwordTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/admin/users/${passwordTarget}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: password }),
      });
      showToast('密码已重置', 'success');
      setPasswordTarget(null);
    } catch (error) {
      showToast(errorMessage(error, '重置密码失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function changeOwnPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      showToast('密码已修改，请重新登录', 'success');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      showToast(errorMessage(error, '修改密码失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'username', label: '用户名' },
    { key: 'name', label: '姓名' },
    {
      key: 'role',
      label: '角色',
      render: (row: UserRow) => {
        const extra = (userRoles.data?.items ?? [])
          .filter((entry) => entry.userId === row.id)
          .map((entry) => entry.role);
        return (
          <>
            {ROLE_LABELS[row.role] ?? row.role}
            {extra.map((role) => (
              <span key={role} className="role-badge">{ROLE_LABELS[role] ?? role}</span>
            ))}
          </>
        );
      },
    },
    { key: 'phone', label: '电话' },
    {
      key: 'active',
      label: '启用',
      render: (row: UserRow) => formatDisplayValue(row.active, { name: 'active', type: 'boolean' }),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: UserRow) => (
        <>
          <button onClick={() => openEdit(row)}>编辑</button>
          <button onClick={() => setPasswordTarget(row.id)}>重置密码</button>
          <button className="danger" onClick={() => setDeleteTarget(row)}>删除</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>员工管理</h1>
        <button onClick={openCreate}>新建员工</button>
      </div>
      <DataTable columns={columns} rows={users.data?.items ?? []} keyField="id" emptyText="暂无员工" />

      <Dialog open={showForm} title={editingId ? '编辑员工' : '新建员工'} onClose={() => setShowForm(false)}>
        <form onSubmit={submit}>
          <label>
            用户名
            <input value={form.username} disabled={Boolean(editingId)} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
          </label>
          {!editingId && (
            <label>
              初始密码
              <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
              <small>至少 8 位</small>
            </label>
          )}
          <label>
            姓名
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            角色
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            电话
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </label>
          <fieldset className="role-checkbox-group">
            <legend>附加岗位</legend>
            {Object.entries(ROLE_LABELS)
              .filter(([value]) => value !== form.role)
              .map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={additionalRoles.includes(value)}
                    onChange={(event) => {
                      setAdditionalRoles((current) => (
                        event.target.checked
                          ? [...current, value]
                          : current.filter((role) => role !== value)
                      ));
                    }}
                  />
                  {label}
                </label>
              ))}
          </fieldset>
          <label>
            <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
            启用账号
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      <PromptDialog
        key={passwordTarget ?? 'no-target'}
        open={passwordTarget !== null}
        title="重置密码"
        message="输入新密码，至少 8 位"
        confirmText="重置"
        onSubmit={(value) => void resetPassword(value)}
        onCancel={() => setPasswordTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除员工"
        message={`确定删除员工「${deleteTarget?.name ?? ''}」吗？删除后该账号将无法登录。`}
        confirmText="删除"
        danger
        onConfirm={() => void deleteUser()}
        onCancel={() => setDeleteTarget(null)}
      />

      <h2>修改我的密码</h2>
      <form className="inline-form" onSubmit={changeOwnPassword}>
        <input type="password" value={oldPassword} placeholder="旧密码" aria-label="旧密码" onChange={(event) => setOldPassword(event.target.value)} />
        <input type="password" value={newPassword} placeholder="新密码" aria-label="新密码" onChange={(event) => setNewPassword(event.target.value)} />
        <input type="password" value={confirmPassword} placeholder="确认新密码" aria-label="确认新密码" onChange={(event) => setConfirmPassword(event.target.value)} />
        <button type="submit" disabled={submitting}>修改密码</button>
      </form>
    </div>
  );
}
