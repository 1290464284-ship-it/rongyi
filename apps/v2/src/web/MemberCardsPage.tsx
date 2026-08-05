import { FormEvent, useRef, useState } from 'react';
import { apiRequest } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, SearchableSelect, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  DISABLED: '禁用',
  FROZEN: '冻结',
  EXPIRED: '过期',
};

const LEVEL_LABELS: Record<string, string> = {
  NORMAL: '普通会员',
  VIP: 'VIP会员',
  SVIP: 'SVIP会员',
};

const ACTION_TITLES: Record<string, string> = {
  RECHARGE: '会员卡充值',
  CONSUME: '会员卡消费',
  POINTS: '积分调整',
};

interface CardRow extends Record<string, unknown> {
  id: string;
  cardNo?: string | null;
  patientId?: string | null;
  patientIdLabel?: string | null;
  balance?: number | null;
  points?: number | null;
  status?: string | null;
  level?: string | null;
}

interface CardForm {
  patientId: string;
  cardNo: string;
  status: string;
  level: string;
}

const emptyForm: CardForm = {
  patientId: '',
  cardNo: '',
  status: 'ACTIVE',
  level: 'NORMAL',
};

const cardColumns: DataTableColumn<CardRow>[] = [
  { key: 'cardNo', label: '卡号' },
  { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
  { key: 'balance', label: '余额', render: (row) => formatMoney(row.balance) },
  { key: 'points', label: '积分' },
  { key: 'status', label: '状态', render: (row) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
  { key: 'level', label: '等级', render: (row) => LEVEL_LABELS[String(row.level ?? '')] ?? String(row.level ?? '') },
];

export function MemberCardsPage() {
  const { showToast } = useToast();
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<'RECHARGE' | 'CONSUME' | 'POINTS' | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const reloadRef = useRef<(() => Promise<unknown>) | null>(null);

  return (
    <>
      <CrudPage<CardRow, CardForm>
        title="会员卡管理"
        createLabel="新建会员卡"
        emptyMessage="暂无会员卡"
        queryKey={['member-cards']}
        endpoint="/resources/memberCards"
        pageSize={100}
        initialForm={emptyForm}
        validate={(form) => (!form.patientId || !form.cardNo.trim() ? '请选择患者并填写卡号' : null)}
        submitOverride={async ({ form }) => {
          await apiRequest('/member-cards', {
            method: 'POST',
            body: JSON.stringify({ patientId: form.patientId, cardNo: form.cardNo.trim(), status: form.status, level: form.level }),
          });
        }}
        messages={{ create: '会员卡已创建' }}
        errorMessages={{ create: '创建会员卡失败' }}
        columns={cardColumns}
        rowActions={(row, ctx) => {
          reloadRef.current = ctx.reload;
          return (
          <>
            <button onClick={() => openAction(row.id, 'RECHARGE')}>充值</button>
            <button onClick={() => openAction(row.id, 'CONSUME')}>消费</button>
            <button onClick={() => openAction(row.id, 'POINTS')}>积分</button>
          </>);
        }}
        renderForm={(ctx) => (
          <>
            <label>
              患者
              <SearchableSelect resource="patients" value={ctx.form.patientId} onChange={(id) => ctx.update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
            </label>
            <label>
              卡号
              <input value={ctx.form.cardNo} onChange={(event) => ctx.update({ cardNo: event.target.value })} />
            </label>
            <label>
              状态
              <select value={ctx.form.status} onChange={(event) => ctx.update({ status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              等级
              <select value={ctx.form.level} onChange={(event) => ctx.update({ level: event.target.value })}>
                {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </>
        )}
      />
      <Dialog open={actionKind !== null} title={ACTION_TITLES[actionKind ?? 'RECHARGE']} onClose={() => setActionKind(null)}>
        <form onSubmit={runAction}>
          <label>
            {actionKind === 'POINTS' ? '积分数量' : '金额（元）'}
            <input type="number" min="0" value={actionValue} onChange={(event) => setActionValue(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setActionKind(null)}>取消</button>
            <button type="submit" disabled={actionBusy}>确认</button>
          </div>
        </form>
      </Dialog>
    </>
  );

  function openAction(id: string, kind: 'RECHARGE' | 'CONSUME' | 'POINTS') {
    setActionTarget(id);
    setActionKind(kind);
    setActionValue('');
  }

  async function runAction(event: FormEvent) {
    event.preventDefault();
    if (!actionTarget || !actionKind || actionBusy) return;
    const value = Number(actionValue || 0);
    if (actionKind === 'POINTS' ? !Number.isInteger(value) || value === 0 : value <= 0) {
      showToast(actionKind === 'POINTS' ? '请输入有效积分' : '请输入有效金额', 'error');
      return;
    }
    setActionBusy(true);
    try {
      const body = actionKind === 'POINTS'
        ? { points: value, requestId: crypto.randomUUID() }
        : { amount: toCents(value), requestId: crypto.randomUUID() };
      const endpoint = actionKind === 'RECHARGE'
        ? `/member-cards/${actionTarget}/recharge`
        : actionKind === 'CONSUME'
          ? `/member-cards/${actionTarget}/consume`
          : `/member-cards/${actionTarget}/points`;
      await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
      showToast('会员卡操作已完成', 'success');
      setActionTarget(null);
      setActionKind(null);
      setActionValue('');
      await reloadRef.current?.();
    } catch (error) {
      showToast(errorMessage(error, '会员卡操作失败'), 'error');
    } finally {
      setActionBusy(false);
    }
  }
}
