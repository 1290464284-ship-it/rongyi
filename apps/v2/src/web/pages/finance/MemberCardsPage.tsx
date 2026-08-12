import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { Dialog, SearchableSelect, type DataTableColumn } from '../../components';
import { formatMoney, toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { MEMBER_CARD_STATUS_LABELS } from '../../lib/status-extra-labels';
import { useToast } from '../../lib/toast-context';
import { MemberCardPlanDialog } from './MemberCardPlanDialog';
import { MemberCardQuoteDialog } from './MemberCardQuoteDialog';

const STATUS_LABELS = MEMBER_CARD_STATUS_LABELS;

const LEVEL_LABELS: Record<string, string> = {
  NORMAL: '普通会员',
  VIP: 'VIP会员',
  SVIP: 'SVIP会员',
};

const ACTION_TITLES: Record<string, string> = {
  RECHARGE: '会员卡充值',
  CONSUME: '会员卡消费',
  POINTS: '积分调整',
  PLAN: '折扣方案',
  QUOTE: '报价试算',
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
  discountRate?: number | null;
  maxDiscountAmount?: number | null;
  roundingMode?: string | null;
  annualDiscountLimit?: number | null;
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
  { key: 'discountRate', label: '折扣率', render: (row) => (row.discountRate != null ? `${row.discountRate}%` : '—') },
];

export function MemberCardsPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<'RECHARGE' | 'CONSUME' | 'POINTS' | 'PLAN' | 'QUOTE' | null>(null);
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
        initialForm={() => {
          editingIdRef.current = null;
          return { ...emptyForm };
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          return {
            patientId: String(row.patientId ?? ''),
            cardNo: String(row.cardNo ?? ''),
            status: String(row.status ?? 'ACTIVE'),
            level: String(row.level ?? 'NORMAL'),
          };
        }}
        validate={(form) => (!form.patientId || !form.cardNo.trim() ? '请选择患者并填写卡号' : null)}
        submitOverride={async ({ form, editing }) => {
          const payload = { patientId: form.patientId, cardNo: form.cardNo.trim(), status: form.status, level: form.level };
          if (editing) {
            await apiRequest(`/resources/memberCards/${editingIdRef.current}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            await apiRequest('/member-cards', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }
        }}
        messages={{ create: '会员卡已创建', update: '会员卡已更新', delete: '会员卡已删除' }}
        errorMessages={{ create: '创建会员卡失败', update: '更新会员卡失败', delete: '删除会员卡失败' }}
        columns={cardColumns}
        canEdit
        canDelete
        dialogTitle={(editing) => (editing ? '编辑会员卡' : '新建会员卡')}
        rowActions={(row, ctx) => (
          <>
            <ReloadSync reload={ctx.reload} onReload={(reload) => { reloadRef.current = reload; }} />
            <button disabled={ctx.stale} onClick={() => openAction(row.id, 'RECHARGE', ctx.stale)}>充值</button>
            <button disabled={ctx.stale} onClick={() => openAction(row.id, 'CONSUME', ctx.stale)}>消费</button>
            <button disabled={ctx.stale} onClick={() => openAction(row.id, 'POINTS', ctx.stale)}>积分</button>
            <button disabled={ctx.stale} onClick={() => openPlan(row, ctx.stale)}>折扣方案</button>
            <button disabled={ctx.stale} onClick={() => openQuote(row, ctx.stale)}>报价试算</button>
          </>
        )}
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
      <MemberCardPlanDialog
        key={`plan-${actionTarget ?? 'closed'}`}
        open={actionKind === 'PLAN'}
        cardId={actionTarget}
        onSaved={() => void reloadRef.current?.()}
        onClose={() => setActionKind(null)}
        showToast={showToast}
      />
      <MemberCardQuoteDialog
        key={`quote-${actionTarget ?? 'closed'}`}
        open={actionKind === 'QUOTE'}
        cardId={actionTarget}
        onClose={() => setActionKind(null)}
        showToast={showToast}
      />
    </>
  );

  function openAction(id: string, kind: 'RECHARGE' | 'CONSUME' | 'POINTS', stale: boolean) {
    if (stale) return;
    setActionTarget(id);
    setActionKind(kind);
    setActionValue('');
  }

  function openPlan(row: CardRow, stale: boolean) {
    if (stale) return;
    setActionTarget(row.id);
    setActionKind('PLAN');
  }

  function openQuote(row: CardRow, stale: boolean) {
    if (stale) return;
    setActionTarget(row.id);
    setActionKind('QUOTE');
  }

  async function runAction(event: FormEvent) {
    event.preventDefault();
    if (!actionTarget || !actionKind || actionKind === 'PLAN' || actionKind === 'QUOTE' || actionBusy) return;
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

// M9：渲染期写 ref 是反模式（StrictMode 双渲染/行集合变化时 ref 可能指向旧实例）。
// 将 ctx.reload 赋值移到 effect 提交后执行，使 ref 与最终提交的渲染一致。
function ReloadSync({
  reload,
  onReload,
}: {
  reload: () => Promise<unknown>;
  onReload: (reload: () => Promise<unknown>) => void;
}) {
  useEffect(() => {
    onReload(reload);
  }, [reload, onReload]);
  return null;
}
