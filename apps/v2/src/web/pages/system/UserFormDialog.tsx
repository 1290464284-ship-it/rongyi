import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Dialog } from '../../components';
import { ROLE_LABELS } from './users-constants';
import type { UserForm } from './users-types';

export function UserFormDialog({
  open,
  editing,
  form,
  setForm,
  additionalRoles,
  setAdditionalRoles,
  isBoss,
  submitting,
  onSubmit,
  onClose,
}: {
  open: boolean;
  editing: boolean;
  form: UserForm;
  setForm: Dispatch<SetStateAction<UserForm>>;
  additionalRoles: string[];
  setAdditionalRoles: Dispatch<SetStateAction<string[]>>;
  isBoss: boolean;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={editing ? '编辑员工' : '新建员工'} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <label>
          用户名
          <input value={form.username} disabled={editing} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
        </label>
        {!editing && (
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
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </Dialog>
  );
}
