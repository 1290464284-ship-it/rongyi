import type { DataTableColumn } from '../../components';
import { formatDisplayValue } from '../../lib/format';
import { ROLE_LABELS } from './users-constants';
import type { UserRoleRow, UserRow } from './users-types';

export function userColumns(handlers: {
  userRoles: UserRoleRow[];
  isBoss: boolean;
  stale: boolean;
  onEdit: (row: UserRow) => void;
  onPermissions: (row: UserRow) => void;
  onResetPassword: (row: UserRow) => void;
  onDelete: (row: UserRow) => void;
}): DataTableColumn<UserRow>[] {
  const { userRoles, isBoss, stale, onEdit, onPermissions, onResetPassword, onDelete } = handlers;
  return [
    { key: 'username', label: '用户名' },
    { key: 'name', label: '姓名' },
    {
      key: 'role',
      label: '角色',
      render: (row: UserRow) => {
        const extra = userRoles
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
            <button disabled={stale} onClick={() => onEdit(row)}>编辑</button>
            <button disabled={stale} onClick={() => onPermissions(row)}>权限</button>
            <button disabled={stale} onClick={() => onResetPassword(row)}>重置密码</button>
            <button className="danger" disabled={stale} onClick={() => onDelete(row)}>删除</button>
          </>
        ) : (
          <span>老板账号</span>
        )
      ),
    },
  ];
}
