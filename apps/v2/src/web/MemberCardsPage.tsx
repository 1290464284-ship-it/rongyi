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
  const [planForm, setPlanForm] = useState({ discountRate: '', maxDiscountAmount: '', roundingMode: 'FLOOR', annualDiscountLimit: '', specialDiscountsJson: '' });
  const [planBusy, setPlanBusy] = useState(false);
  const [quoteValue, setQuoteValue] = useState('');
  const [quoteResult, setQuoteResult] = useState<Record<string, unknown> | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
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
        rowActions={(row, ctx) => {
          reloadRef.current = ctx.reload;
          return (
          <>
            <button onClick={() => openAction(row.id, 'RECHARGE')}>充值</button>
            <button onClick={() => openAction(row.id, 'CONSUME')}>消费</button>
            <button onClick={() => openAction(row.id, 'POINTS')}>积分</button>
            <button onClick={() => openPlan(row)}>折扣方案</button>
            <button onClick={() => openQuote(row)}>报价试算</button>
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
      <Dialog open={actionKind === 'PLAN'} title={ACTION_TITLES.PLAN} onClose={() => setActionKind(null)}>
        <form onSubmit={savePlan}>
          <label>
            折扣率(%)
            <input type="number" min="0" max="100" value={planForm.discountRate} onChange={(event) => setPlanForm({ ...planForm, discountRate: event.target.value })} />
          </label>
          <label>
            单次折扣上限(元)
            <input type="number" min="0" value={planForm.maxDiscountAmount} onChange={(event) => setPlanForm({ ...planForm, maxDiscountAmount: event.target.value })} />
          </label>
          <label>
            取整方式
            <select value={planForm.roundingMode} onChange={(event) => setPlanForm({ ...planForm, roundingMode: event.target.value })}>
              <option value="NONE">不取整</option>
              <option value="FLOOR">抹零向下</option>
              <option value="ROUND">四舍五入</option>
            </select>
          </label>
          <label>
            年度折扣上限(元)
            <input type="number" min="0" value={planForm.annualDiscountLimit} onChange={(event) => setPlanForm({ ...planForm, annualDiscountLimit: event.target.value })} />
          </label>
          <label>
            特殊项目折扣
            <textarea rows={3} value={planForm.specialDiscountsJson} onChange={(event) => setPlanForm({ ...planForm, specialDiscountsJson: event.target.value })} placeholder='[{"name":"隐形矫正","category":"ORTHODONTIC","rate":90}]' />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setActionKind(null)}>取消</button>
            <button type="submit" disabled={planBusy}>保存</button>
          </div>
        </form>
      </Dialog>
      <Dialog open={actionKind === 'QUOTE'} title={ACTION_TITLES.QUOTE} onClose={closeQuote}>
        <form onSubmit={runQuote}>
          <label>
            原价金额（元）
            <input type="number" min="0" value={quoteValue} onChange={(event) => { setQuoteValue(event.target.value); setQuoteResult(null); }} />
          </label>
          {quoteResult && (quoteResult.applied === false ? (
            <p className="error">该卡无折扣方案</p>
          ) : (
            <div className="quote-result">
              <p>折后应付：{formatMoney(quoteResult.total)}</p>
              <p>优惠：{formatMoney(quoteResult.discount)}</p>
              <p>年度剩余：{formatMoney(quoteResult.annualRemaining)}</p>
            </div>
          ))}
          <div className="modal-actions">
            <button type="button" onClick={closeQuote}>取消</button>
            <button type="submit" disabled={quoteBusy}>试算</button>
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

  function openPlan(row: CardRow) {
    setActionTarget(row.id);
    setActionKind('PLAN');
    setPlanForm({ discountRate: '', maxDiscountAmount: '', roundingMode: 'FLOOR', annualDiscountLimit: '', specialDiscountsJson: '' });
  }

  function openQuote(row: CardRow) {
    setActionTarget(row.id);
    setActionKind('QUOTE');
    setQuoteValue('');
    setQuoteResult(null);
  }

  function closeQuote() {
    setActionKind(null);
    setQuoteResult(null);
  }

  async function savePlan(event: FormEvent) {
    event.preventDefault();
    if (!actionTarget || actionKind !== 'PLAN' || planBusy) return;
    let specialDiscountsJson: unknown = null;
    const rawJson = planForm.specialDiscountsJson.trim();
    if (rawJson) {
      try {
        specialDiscountsJson = JSON.parse(rawJson);
      } catch {
        showToast('特殊项目折扣 JSON 格式错误', 'error');
        return;
      }
    }
    setPlanBusy(true);
    try {
      await apiRequest(`/member-cards/${actionTarget}/discount-plan`, {
        method: 'PUT',
        body: JSON.stringify({
          discountRate: planForm.discountRate === '' ? null : Number(planForm.discountRate),
          maxDiscountAmount: planForm.maxDiscountAmount === '' ? null : toCents(planForm.maxDiscountAmount),
          roundingMode: planForm.roundingMode,
          annualDiscountLimit: planForm.annualDiscountLimit === '' ? null : toCents(planForm.annualDiscountLimit),
          specialDiscountsJson,
        }),
      });
      showToast('折扣方案已保存', 'success');
      setActionTarget(null);
      setActionKind(null);
      await reloadRef.current?.();
    } catch (error) {
      showToast(errorMessage(error, '保存折扣方案失败'), 'error');
    } finally {
      setPlanBusy(false);
    }
  }

  async function runQuote(event: FormEvent) {
    event.preventDefault();
    if (!actionTarget || actionKind !== 'QUOTE' || quoteBusy) return;
    const value = Number(quoteValue || 0);
    if (!Number.isFinite(value) || value < 0) {
      showToast('请输入有效金额', 'error');
      return;
    }
    setQuoteBusy(true);
    try {
      const data = await apiRequest<Record<string, unknown>>(`/member-cards/${actionTarget}/quote`, {
        method: 'POST',
        body: JSON.stringify({ baseTotal: toCents(value) }),
      });
      setQuoteResult(data);
    } catch (error) {
      showToast(errorMessage(error, '报价试算失败'), 'error');
    } finally {
      setQuoteBusy(false);
    }
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
