import { FormEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import {
  ConfirmDialog,
  DataTable,
  LoadingState,
  PageError,
  PagePager,
  PromptDialog,
} from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { ChangeOwnPasswordForm } from './ChangeOwnPasswordForm';
import { userColumns } from './users-columns';
import { PERMISSION_KEYS } from './users-constants';
import { UserFormDialog } from './UserFormDialog';
import { PermissionDialog } from './PermissionDialog';
import { emptyForm, USER_PAGE_SIZE, type UserForm, type UserRoleRow, type UserRow } from './users-types';

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
    // 与 Layout 同端点共享缓存键，避免重复请求 /auth/me
    queryKey: ['me'],
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

  // userColumns 仅存储回调供 DataTable 行点击时调用；ref 读取发生在事件处理器中，
  // 不在渲染期 —— react-hooks/refs 静态分析无法区分，属误报
  // eslint-disable-next-line react-hooks/refs
  const columns = userColumns({
    userRoles: userRoles.data?.items ?? [],
    isBoss,
    stale,
    onEdit: openEdit,
    onPermissions: (row) => void openPermissions(row),
    onResetPassword: (row) => setPasswordTarget(row.id),
    onDelete: setDeleteTarget,
  });

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

      <UserFormDialog
        open={showForm}
        editing={editingId !== null}
        form={form}
        setForm={setForm}
        additionalRoles={additionalRoles}
        setAdditionalRoles={setAdditionalRoles}
        isBoss={isBoss}
        submitting={submitting}
        onSubmit={submit}
        onClose={() => setShowForm(false)}
      />

      <PermissionDialog
        target={permissionTarget}
        permissionForm={permissionForm}
        setPermissionForm={setPermissionForm}
        busy={permissionBusy}
        onSave={savePermissions}
        onClose={() => setPermissionTarget(null)}
      />

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
