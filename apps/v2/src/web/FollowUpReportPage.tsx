import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';

interface FollowUpAdherence {
  total: number;
  onTime: number;
  rate: number;
}

export function FollowUpReportPage() {
  const query = useQuery({
    queryKey: ['followup-report'],
    queryFn: () => apiRequest<FollowUpAdherence>('/follow-ups/adherence'),
  });
  if (query.isLoading) return <div className="page">Loading...</div>;
  if (query.error) return <div className="page error">{(query.error as Error).message}</div>;
  const data = query.data ?? { total: 0, onTime: 0, rate: 0 };
  return (
    <div className="page">
      <h1>随访到诊率</h1>
      <div className="board-summary">
        <div className="summary-item"><span>随访总数</span><strong>{data.total}</strong></div>
        <div className="summary-item"><span>按时完成</span><strong>{data.onTime}</strong></div>
        <div className="summary-item"><span>到诊率</span><strong>{data.rate}%</strong></div>
      </div>
    </div>
  );
}
