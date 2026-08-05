import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { QueryBoundary } from './components';

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
  const data = query.data ?? { total: 0, onTime: 0, rate: 0 };
  return (
    <QueryBoundary isLoading={query.isLoading} error={query.error} data={query.data} errorLabel="无法加载随访到诊率">
      <div className="page">
        <h1>随访到诊率</h1>
        <div className="board-summary">
          <div className="summary-item"><span>随访总数</span><strong>{data.total}</strong></div>
          <div className="summary-item"><span>按时完成</span><strong>{data.onTime}</strong></div>
          <div className="summary-item"><span>到诊率</span><strong>{data.rate}%</strong></div>
        </div>
      </div>
    </QueryBoundary>
  );
}
