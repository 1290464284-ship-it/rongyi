import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';

interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }

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

  return (
    <div className="page">
      <h1>财务操作</h1>
      {message && <p className="info">{message}</p>}
      <h2>会员卡</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Card</th><th>Balance</th><th>Actions</th></tr></thead>
          <tbody>
            {cards.data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id).slice(0, 8)}</td>
                <td>{String(row.cardNo ?? '')}</td>
                <td>{String(row.balance ?? '')}</td>
                <td>
                  <button onClick={() => recharge(String(row.id))}>充值</button>
                  <button onClick={() => consume(String(row.id))}>消费</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>欠费</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Total</th><th>Paid</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {debts.data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id).slice(0, 8)}</td>
                <td>{String(row.totalAmount ?? '')}</td>
                <td>{String(row.paidAmount ?? '')}</td>
                <td>{String(row.status ?? '')}</td>
                <td><button onClick={() => payDebt(String(row.id))}>还款</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
