import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

export function FinanceWorkflowPage() {
  const [message, setMessage] = useState('');
  const cards = useQuery({
    queryKey: ['member-cards'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/memberCards?page=1&pageSize=100'),
  });
  const debts = useQuery({
    queryKey: ['debts'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/debtRecords?page=1&pageSize=100'),
  });

  async function run(path: string, id: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') {
    try {
      const result = await apiRequest<Record<string, unknown>>(path, { method, body: JSON.stringify(body) });
      setMessage(JSON.stringify(result));
      await Promise.all([cards.refetch(), debts.refetch()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    }
  }

  async function recharge(cardId: string) {
    const amount = Number(prompt('充值金额（分）') ?? 0);
    await run(`/member-cards/${cardId}/recharge`, cardId, { amount, requestId: `ui-${Date.now()}` });
  }

  async function consume(cardId: string) {
    const amount = Number(prompt('消费金额（分）') ?? 0);
    await run(`/member-cards/${cardId}/consume`, cardId, { amount, requestId: `ui-${Date.now()}` });
  }

  async function payDebt(debtId: string) {
    const amount = Number(prompt('还款金额（分）') ?? 0);
    await run(`/debts/${debtId}/pay`, debtId, { amount, requestId: `ui-${Date.now()}` }, 'PATCH');
  }

  const cardColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'cardNo', label: 'Card', render: (row) => String(row.cardNo ?? '') },
    { key: 'balance', label: 'Balance', render: (row) => String(row.balance ?? '') },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <>
          <button onClick={() => recharge(String(row.id))}>充值</button>
          <button onClick={() => consume(String(row.id))}>消费</button>
        </>
      ),
    },
  ];

  const debtColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'totalAmount', label: 'Total', render: (row) => String(row.totalAmount ?? '') },
    { key: 'paidAmount', label: 'Paid', render: (row) => String(row.paidAmount ?? '') },
    { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => <button onClick={() => payDebt(String(row.id))}>还款</button>,
    },
  ];

  return (
    <div className="page">
      <h1>财务操作</h1>
      {message && <p className="info">{message}</p>}
      <h2>会员卡</h2>
      <DataTable columns={cardColumns} rows={cards.data?.items ?? []} keyField="id" emptyText="No member cards" />
      <h2>欠费</h2>
      <DataTable columns={debtColumns} rows={debts.data?.items ?? []} keyField="id" emptyText="No debts" />
    </div>
  );
}
