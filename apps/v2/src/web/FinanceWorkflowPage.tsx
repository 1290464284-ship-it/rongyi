import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError, PromptDialog, type DataTableColumn } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

type MoneyAction =
  | { kind: 'recharge'; id: string; title: string }
  | { kind: 'consume'; id: string; title: string }
  | { kind: 'debt'; id: string; title: string }
  | null;

export function FinanceWorkflowPage() {
  const { showToast } = useToast();
  const [action, setAction] = useState<MoneyAction>(null);
  const cards = useQuery({
    queryKey: ['member-cards'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/memberCards?page=1&pageSize=100'),
  });
  const debts = useQuery({
    queryKey: ['debts'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/debtRecords?page=1&pageSize=100'),
  });

  if (cards.isLoading || debts.isLoading) return <LoadingState label="财务数据加载中..." />;
  const loadError = cards.error ?? debts.error;
  if (loadError) {
    return (
      <div className="page">
        <PageError message={loadError instanceof Error ? loadError.message : String(loadError)} />
        <button onClick={() => {
          void cards.refetch();
          void debts.refetch();
        }}>重试</button>
      </div>
    );
  }

  async function run(path: string, id: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') {
    try {
      await apiRequest<Record<string, unknown>>(path, { method, body: JSON.stringify(body) });
      showToast('操作成功', 'success');
      await Promise.all([cards.refetch(), debts.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  async function submitAmount(value: string) {
    const amount = toCents(value);
    if (!action) return;
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('请输入有效金额', 'error');
      setAction(null);
      return;
    }
    if (action.kind === 'recharge') {
      await run(`/member-cards/${action.id}/recharge`, action.id, { amount, requestId: crypto.randomUUID() });
    } else if (action.kind === 'consume') {
      await run(`/member-cards/${action.id}/consume`, action.id, { amount, requestId: crypto.randomUUID() });
    } else if (action.kind === 'debt') {
      await run(`/debts/${action.id}/pay`, action.id, { amount, requestId: crypto.randomUUID() }, 'PATCH');
    }
    setAction(null);
  }

  const cardColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'cardNo', label: '卡号', render: (row) => String(row.cardNo ?? '') },
    { key: 'balance', label: '余额', render: (row) => formatMoney(row.balance) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <button onClick={() => setAction({ kind: 'recharge', id: String(row.id), title: '会员卡充值' })}>充值</button>
          <button onClick={() => setAction({ kind: 'consume', id: String(row.id), title: '会员卡消费' })}>消费</button>
        </>
      ),
    },
  ];

  const debtColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'totalAmount', label: '应收', render: (row) => formatMoney(row.totalAmount) },
    { key: 'paidAmount', label: '已收', render: (row) => formatMoney(row.paidAmount) },
    { key: 'status', label: '状态', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => <button onClick={() => setAction({ kind: 'debt', id: String(row.id), title: '欠费还款' })}>还款</button>,
    },
  ];

  return (
    <div className="page">
      <h1>财务操作</h1>
      <h2>会员卡</h2>
      <DataTable columns={cardColumns} rows={cards.data?.items ?? []} keyField="id" emptyText="暂无会员卡" />
      <h2>欠费</h2>
      <DataTable columns={debtColumns} rows={debts.data?.items ?? []} keyField="id" emptyText="暂无欠费" />
      <PromptDialog
        key={action !== null ? 'open' : 'closed'}
        open={action !== null}
        title={action?.title ?? '金额操作'}
        message="请输入金额，单位：元"
        value=""
        inputType="number"
        placeholder="例如：100"
        confirmText="确认"
        onSubmit={(value) => void submitAmount(value)}
        onCancel={() => setAction(null)}
      />
    </div>
  );
}
