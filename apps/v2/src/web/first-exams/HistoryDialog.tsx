import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { formatDateTime } from '../lib/format';
import { DENTITION_LABELS, FOLLOW_UP_STATUS_LABELS, STATUS_LABELS } from './constants';
import type { FirstExamHistoryItem, FirstExamRow } from './types';

export function HistoryDialog({ row, onClose }: { row: FirstExamRow; onClose: () => void }) {
  const historyQuery = useQuery({
    queryKey: ['first-exam-history', row.id],
    queryFn: () => apiRequest<FirstExamHistoryItem[]>(`/first-exams/history?patientId=${encodeURIComponent(String(row.patientId))}`),
    enabled: Boolean(row.patientId),
  });
  const items = historyQuery.data ?? [];

  return (
    <Dialog open title="首诊历史" onClose={onClose}>
      {!row.patientId ? (
        <p>该记录缺少患者信息，无法查看历史</p>
      ) : historyQuery.isLoading ? (
        <p>加载中...</p>
      ) : items.length === 0 ? (
        <p>暂无历史记录</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>主诉</th>
              <th>牙列</th>
              <th>状态</th>
              <th>追踪</th>
              <th>重启</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {formatDateTime(item.createdAt)}
                  {item.id === row.id ? '（当前）' : ''}
                </td>
                <td>{item.chiefComplaint ?? ''}</td>
                <td>{DENTITION_LABELS[String(item.dentition ?? '')] ?? String(item.dentition ?? '')}</td>
                <td>{STATUS_LABELS[String(item.status ?? '')] ?? String(item.status ?? '')}</td>
                <td>{FOLLOW_UP_STATUS_LABELS[String(item.followUpStatus ?? 'NONE')] ?? String(item.followUpStatus)}</td>
                <td>
                  {item.previousExamId
                    ? item.restartedAt
                      ? `已重启 ${formatDateTime(item.restartedAt)}`
                      : `由 ${item.previousExamId} 重启`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}
