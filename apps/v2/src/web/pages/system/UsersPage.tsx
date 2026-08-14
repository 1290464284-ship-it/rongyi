import { FormEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import {
  ConfirmDialog,
  DataTable,
  Dialog,
  LoadingState,
  PageError,
  PagePager,
  PromptDialog,
} from '../../components';
import { formatDisplayValue } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { ChangeOwnPasswordForm } from './ChangeOwnPasswordForm';

const ROLE_LABELS: Record<string, string> = {
  BOSS: '老板',
  ADMIN: '管理员',
  DOCTOR: '医生',
};

const PERMISSION_KEYS = [
  'dashboard',
  'frontDesk',
  'patients',
  'clinical',
  'finance',
  'inventory',
  'analytics',
  'communication',
  'hr',
  'system',
];

const PERMISSION_LABELS: Record<string, string> = {
  dashboard: '经营报表',
  frontDesk: '前台工作',
  patients: '患者档案',
  clinical: '临床诊疗',
  finance: '收费财务',
  inventory: '库存采购',
  analytics: '经营分析',
  communication: '随访微信',
  hr: '人事排班',
  system: '系统管理',
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

const USER_PAGE_SIZE = 100;

export function UsersPage() {
  const { showToast } = useToast();
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [additionalRoles, setAdditionalRoles] = useState<string[]>([]);
  const [permissionTarget, setPermissionTarget] = useState<UserRow | null>(null);
  const [permissionForm, setPermissionForm] = useState<Record<string, boolean>>({});
  const [permissionBusy, setPermissionBusy] = useState(false);
  const permissionRequestRef = useRef(0);
  const [page, setPage] = useState(1);

  const me = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => apiRequest<{ role?: string }>('/auth/me'),
  });
  const users = useQuery({
    queryKey: ['users', page],
    queryFn: () => apiRequest<Page<UserRow>>(`/resources/users?page=${page}&pageSize=${USER_PAGE_SIZE}`),
    placeholderData: (previous) => previous,
    enabled: me.data?.role === 'BOSS' || me.data?.role === 'ADMIN',
  });
  const userRoles = useQuery({
    queryKey: ['user-roles'],
    queryFn: () => apiRequest<{ items: UserRoleRow[] }>('/user-roles'),
    enabled: me.data?.role === 'BOSS' || me.data?.role === 'ADMIN',
  });
  const stale = users.isPlaceholderData;

  if (me.isLoading) return <LoadingState />;
  if (me.error || !['BOSS', 'ADMIN'].includes(me.data?.role ?? '')) {
    return <PageError message="仅老板或管理员可管理员工账号" />;
  }
  const isBoss = me.data?.role === 'BOSS';
  if (users.isLoading) return <LoadingState />;
  if (users.error) return <PageError message={(users.error as Error).message} />;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setAdditionalRoles([]);
    setShowForm(true);
  }

  function openEdit(row: UserRow) {
    if (userRoles.error) {
      showToast('角色数据加载失败，请刷新后重试', 'error');
      return;
    }
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
    if (stale) return;
    if (submitting) return;
    if (editingId && userRoles.error) {
      showToast('角色数据加载失败，请刷新后重试', 'error');
      return;
    }
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
    if (stale) return;
    /* v8 ignore next -- 确认框按钮仅在 deleteTarget 非空时渲染且 pending 期间 disabled，守卫为防御冗余 */
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
    if (stale) return;
    /* v8 ignore next -- 重置弹窗仅在 passwordTarget 非空时渲染且 pending 期间确认按钮 disabled，守卫为防御冗余 */
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

  async function openPermissions(row: UserRow) {
    const requestId = permissionRequestRef.current + 1;
    permissionRequestRef.current = requestId;
    setPermissionTarget(row);
    setPermissionBusy(true);
    try {
      const data = await apiRequest<{ effective: string[] }>(`/user-permissions/${row.id}`);
      if (requestId !== permissionRequestRef.current) return;
      const effective = new Set(data.effective ?? []);
      setPermissionForm(Object.fromEntries(PERMISSION_KEYS.map((key) => [key, effective.has(key)])));
    } catch (error) {
      showToast(errorMessage(error, '加载权限失败'), 'error');
      setPermissionTarget(null);
    } finally {
      if (requestId === permissionRequestRef.current) setPermissionBusy(false);
    }
  }

  async function savePermissions() {
    if (stale) return;
    /* v8 ignore next -- 保存按钮仅在权限弹窗内渲染且 permissionBusy 期间 disabled，守卫为防御冗余 */
    if (!permissionTarget || permissionBusy) return;
    setPermissionBusy(true);
    try {
      await apiRequest(`/user-permissions/${permissionTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          permissions: PERMISSION_KEYS.map((key) => ({
            permission: key,
            allowed: Boolean(permissionForm[key]),
          })),
        }),
      });
      showToast('用户权限已更新', 'success');
      setPermissionTarget(null);
    } catch (error) {
      showToast(errorMessage(error, '保存权限失败'), 'error');
    } finally {
      setPermissionBusy(false);
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
        isBoss || row.role !== 'BOSS' ? (
          <>
            <button disabled={stale} onClick={() => openEdit(row)}>编辑</button>
            <button disabled={stale} onClick={() => void openPermissions(row)}>权限</button>
            <button disabled={stale} onClick={() => setPasswordTarget(row.id)}>重置密码</button>
            <button className="danger" disabled={stale} onClick={() => setDeleteTarget(row)}>删除</button>
          </>
        ) : (
          <span>老板账号</span>
        )
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>员工管理</h1>
        <button onClick={openCreate}>新建员工</button>
      </div>
      {userRoles.error && <p className="error">角色数据加载失败，请刷新后重试</p>}
      <DataTable columns={columns} rows={users.data?.items ?? []} keyField="id" emptyText="暂无员工" />
      <PagePager
        page={page}
        hasNext={page * USER_PAGE_SIZE < (users.data?.total ?? 0)}
        onPageChange={setPage}
        disabled={stale}
      />

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
              <small>至少 6 位</small>
            </label>
          )}
          <label>
            姓名
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            角色
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
              {Object.entries(ROLE_LABELS)
                .filter(([value]) => isBoss || value !== 'BOSS')
                .map(([value, label]) => (
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
              .filter(([value]) => value !== form.role && (isBoss || value !== 'BOSS'))
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

      <Dialog
        open={permissionTarget !== null}
        title={`设置「${permissionTarget?.name ?? ''}」的权限`}
        onClose={() => setPermissionTarget(null)}
      >
        <div className="role-checkbox-group">
          {/* PERMISSION_KEYS 全部存在于 PERMISSION_LABELS 中，`?? key` 兜底为死代码，已删除。 */}
          {PERMISSION_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={Boolean(permissionForm[key])}
                disabled={permissionBusy}
                onChange={(event) => setPermissionForm((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {PERMISSION_LABELS[key]}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => setPermissionTarget(null)}>取消</button>
          <button disabled={permissionBusy} onClick={() => void savePermissions()}>
            {permissionBusy ? '保存中...' : '保存权限'}
          </button>
        </div>
      </Dialog>

      <PromptDialog
        key={passwordTarget ?? 'no-target'}
        open={passwordTarget !== null}
        title="重置密码"
        message="输入新密码，至少 6 位"
        confirmText="重置"
        pending={submitting}
        onSubmit={(value) => void resetPassword(value)}
        onCancel={() => setPasswordTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除员工"
        message={`确定删除员工「${deleteTarget?.name ?? ''}」吗？删除后该账号将无法登录。`}
        confirmText="删除"
        danger
        onConfirm={() => deleteUser()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ChangeOwnPasswordForm showToast={showToast} />
    </div>
  );
}
