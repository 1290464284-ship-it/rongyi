import type { Dispatch, SetStateAction } from 'react';
import { Dialog } from '../../components';
import { PERMISSION_KEYS, PERMISSION_LABELS } from './users-constants';
import type { UserRow } from './users-types';

export function PermissionDialog({
  target,
  permissionForm,
  setPermissionForm,
  busy,
  onSave,
  onClose,
}: {
  target: UserRow | null;
  permissionForm: Record<string, boolean>;
  setPermissionForm: Dispatch<SetStateAction<Record<string, boolean>>>;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      title={`设置「${target?.name ?? ''}」的权限`}
      onClose={onClose}
    >
      <div className="role-checkbox-group">
        {/* PERMISSION_KEYS 全部存在于 PERMISSION_LABELS 中，`?? key` 兜底为死代码，已删除。 */}
        {PERMISSION_KEYS.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={Boolean(permissionForm[key])}
              disabled={busy}
              onChange={(event) => setPermissionForm((current) => ({ ...current, [key]: event.target.checked }))}
            />
            {PERMISSION_LABELS[key]}
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button disabled={busy} onClick={() => void onSave()}>
          {busy ? '保存中...' : '保存权限'}
        </button>
      </div>
    </Dialog>
  );
}
