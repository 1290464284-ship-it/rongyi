import { FormEvent, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { ConfirmDialog, Dialog } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import type { ToastKind } from '../../lib/toast-context';
import type { PurposeRow, PurposeForm } from '../../appointments/types';

interface AppointmentPurposePanelProps {
  purposes: UseQueryResult<Page<PurposeRow>, Error>;
  showToast: (message: string, kind?: ToastKind) => void;
}

export function AppointmentPurposePanel({ purposes, showToast }: AppointmentPurposePanelProps) {
  const [newPurposeName, setNewPurposeName] = useState('');
  const [purposeBusy, setPurposeBusy] = useState(false);
  const [editingPurpose, setEditingPurpose] = useState<PurposeRow | null>(null);
  const [purposeForm, setPurposeForm] = useState<PurposeForm>({ name: '', color: '', sortOrder: '', active: true });
  const [purposeDeleteTarget, setPurposeDeleteTarget] = useState<PurposeRow | null>(null);

  async function addPurpose(event: FormEvent) {
    event.preventDefault();
    const name = newPurposeName.trim();
    if (purposeBusy || !name) {
      showToast('请输入事项名称', 'error');
      return;
    }
    setPurposeBusy(true);
    try {
      await apiRequest('/resources/appointmentPurposes', {
        method: 'POST',
        body: JSON.stringify({ name, active: true }),
      });
      showToast('事项已添加', 'success');
      setNewPurposeName('');
      await purposes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '添加事项失败'), 'error');
    } finally {
      setPurposeBusy(false);
    }
  }

  async function togglePurpose(row: PurposeRow) {
    try {
      const active = Number(row.active) === 1;
      await apiRequest(`/resources/appointmentPurposes/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !active }),
      });
      showToast('事项状态已更新', 'success');
      await purposes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '更新事项失败'), 'error');
    }
  }

  function openEditPurpose(row: PurposeRow) {
    setPurposeForm({
      name: String(row.name ?? ''),
      color: String(row.color ?? ''),
      sortOrder: String(row.sortOrder ?? 0),
      active: Number(row.active) === 1,
    });
    setEditingPurpose(row);
  }

  async function saveEditPurpose(event: FormEvent) {
    event.preventDefault();
    if (!editingPurpose || purposeBusy) return;
    if (!purposeForm.name.trim()) {
      showToast('请输入事项名称', 'error');
      return;
    }
    setPurposeBusy(true);
    try {
      await apiRequest(`/resources/appointmentPurposes/${editingPurpose.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: purposeForm.name.trim(),
          color: purposeForm.color.trim() || undefined,
          sortOrder: Number(purposeForm.sortOrder) || 0,
          active: purposeForm.active,
        }),
      });
      showToast('事项已更新', 'success');
      setEditingPurpose(null);
      await purposes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '更新事项失败'), 'error');
    } finally {
      setPurposeBusy(false);
    }
  }

  async function deletePurpose() {
    if (!purposeDeleteTarget || purposeBusy) return;
    setPurposeBusy(true);
    try {
      await apiRequest(`/resources/appointmentPurposes/${purposeDeleteTarget.id}`, { method: 'DELETE' });
      showToast('事项已删除', 'success');
      setPurposeDeleteTarget(null);
      await purposes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '删除事项失败'), 'error');
      setPurposeDeleteTarget(null);
    } finally {
      setPurposeBusy(false);
    }
  }

  return (
    <>
      <section className="analytics-panel" aria-label="预约事项管理">
        <h2>预约事项管理</h2>
        <ul className="purpose-list">
          {(purposes.data?.items ?? []).map((row) => (
            <li key={row.id}>
              <span>{String(row.name ?? row.id)}</span>
              <TogglePurposeButton row={row} onToggle={togglePurpose} />
              <button type="button" onClick={() => openEditPurpose(row)}>编辑</button>
              <button type="button" className="danger" onClick={() => setPurposeDeleteTarget(row)}>删除</button>
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={addPurpose}>
          <input aria-label="新事项名称" type="text" value={newPurposeName} onChange={(event) => setNewPurposeName(event.target.value)} placeholder="新事项名称" />
          <button type="submit" disabled={purposeBusy}>{purposeBusy ? '添加中...' : '添加事项'}</button>
        </form>
      </section>

      <Dialog open={editingPurpose !== null} title="编辑预约事项" onClose={() => setEditingPurpose(null)}>
        <form onSubmit={saveEditPurpose}>
          <label>
            事项名称
            <input value={purposeForm.name} onChange={(event) => setPurposeForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            颜色
            <input type="color" value={purposeForm.color || '#3b82f6'} onChange={(event) => setPurposeForm((current) => ({ ...current, color: event.target.value }))} />
          </label>
          <label>
            排序
            <input type="number" value={purposeForm.sortOrder} onChange={(event) => setPurposeForm((current) => ({ ...current, sortOrder: event.target.value }))} />
          </label>
          <label>
            <input type="checkbox" checked={purposeForm.active} onChange={(event) => setPurposeForm((current) => ({ ...current, active: event.target.checked }))} />
            启用
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setEditingPurpose(null)}>取消</button>
            <button type="submit" disabled={purposeBusy}>{purposeBusy ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={purposeDeleteTarget !== null}
        title="删除预约事项"
        message={`确定删除事项「${purposeDeleteTarget?.name ?? ''}」吗？`}
        confirmText="删除"
        danger
        onConfirm={() => deletePurpose()}
        onCancel={() => setPurposeDeleteTarget(null)}
      />
    </>
  );
}

/** 事项启用/停用按钮：busy 期间禁用，防止双击导致状态来回切换。 */
function TogglePurposeButton({ row, onToggle }: { row: PurposeRow; onToggle: (row: PurposeRow) => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  return (
    <button type="button" disabled={busy} onClick={() => run(() => onToggle(row))}>
      {Number(row.active) === 1 ? '停用' : '启用'}
    </button>
  );
}
