import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError } from './components';
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

interface CardRow extends Record<string, unknown> {
  id: string;
  cardNo?: string | null;
  patientId?: string | null;
  balance?: number | null;
  points?: number | null;
  status?: string | null;
  level?: string | null;
}

export function MemberCardsPage() {
  const { showToast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [cardNo, setCardNo] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [level, setLevel] = useState('NORMAL');
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<'RECHARGE' | 'CONSUME' | 'POINTS' | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const patients = useQuery({
    queryKey: ['card-patients'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=200'),
  });
  const query = useQuery({
    queryKey: ['member-cards'],
    queryFn: () => apiRequest<Page<CardRow>>('/resources/memberCards?page=1&pageSize=100'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting || !patientId || !cardNo.trim()) {
      showToast('请选择患者并填写卡号', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/member-cards', {
        method: 'POST',
        body: JSON.stringify({ patientId, cardNo: cardNo.trim(), status, level }),
      });
      showToast('会员卡已创建', 'success');
      setShowCreate(false);
      setPatientId('');
      setCardNo('');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建会员卡失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(event: FormEvent) {
    event.preventDefault();
    if (!actionTarget || !actionKind || submitting) return;
    const value = Number(actionValue || 0);
    if (actionKind === 'POINTS' ? !Number.isInteger(value) || value === 0 : value <= 0) {
      showToast(actionKind === 'POINTS' ? '请输入有效积分' : '请输入有效金额', 'error');
      return;
    }
    setSubmitting(true);
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
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '会员卡操作失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'cardNo', label: '卡号' },
    { key: 'patientId', label: '患者' },
    { key: 'balance', label: '余额', render: (row: CardRow) => formatMoney(row.balance) },
    { key: 'points', label: '积分' },
    { key: 'status', label: '状态', render: (row: CardRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? '') },
    { key: 'level', label: '等级', render: (row: CardRow) => LEVEL_LABELS[String(row.level ?? '')] ?? String(row.level ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row: CardRow) => (
        <>
          <button onClick={() => openAction(row.id, 'RECHARGE')}>充值</button>
          <button onClick={() => openAction(row.id, 'CONSUME')}>消费</button>
          <button onClick={() => openAction(row.id, 'POINTS')}>积分</button>
        </>
      ),
    },
  ];

  function openAction(id: string, kind: 'RECHARGE' | 'CONSUME' | 'POINTS') {
    setActionTarget(id);
    setActionKind(kind);
    setActionValue('');
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>会员卡管理</h1>
        <button onClick={() => setShowCreate(true)}>新建会员卡</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无会员卡" />
      )}

      <Dialog open={showCreate} title="新建会员卡" onClose={() => setShowCreate(false)}>
        <form onSubmit={create}>
          <label>
            患者
            <select value={patientId} onChange={(event) => setPatientId(event.target.value)}>
              <option value="">选择患者</option>
              {patients.data?.items.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
              ))}
            </select>
          </label>
          <label>
            卡号
            <input value={cardNo} onChange={(event) => setCardNo(event.target.value)} />
          </label>
          <label>
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            等级
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowCreate(false)}>取消</button>
            <button type="submit" disabled={submitting}>保存</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={actionKind !== null} title={ACTION_TITLES[actionKind ?? 'RECHARGE']} onClose={() => setActionKind(null)}>
        <form onSubmit={runAction}>
          <label>
            {actionKind === 'POINTS' ? '积分数量' : '金额（元）'}
            <input type="number" min="0" value={actionValue} onChange={(event) => setActionValue(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setActionKind(null)}>取消</button>
            <button type="submit" disabled={submitting}>确认</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

const ACTION_TITLES: Record<string, string> = {
  RECHARGE: '会员卡充值',
  CONSUME: '会员卡消费',
  POINTS: '积分调整',
};
