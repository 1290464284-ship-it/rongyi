import { useQuery } from '@tanstack/react-query';
import { apiRequest, downloadCsv } from '../../lib/api';
import { QueryBoundary } from '../../components';
import { friendlyError } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

interface FollowUpAdherence {
  total: number;
  onTime: number;
  rate: number;
}

export function FollowUpReportPage() {
  const { showToast } = useToast();
  const query = useQuery({
    queryKey: ['followup-report'],
    queryFn: () => apiRequest<FollowUpAdherence>('/follow-ups/adherence'),
  });
  const data = query.data ?? { total: 0, onTime: 0, rate: 0 };
  async function exportFollowUps() {
    try {
      await downloadCsv('followUps');
      showToast('随访明细已导出', 'success');
    } catch (error) {
      showToast(friendlyError(error), 'error');
    }
  }
  return (
    <QueryBoundary isLoading={query.isLoading} error={query.error} data={query.data} errorLabel="无法加载随访到诊率">
      <div className="page">
        <div className="page-head">
          <h1>随访到诊率</h1>
          <button onClick={() => void exportFollowUps()}>导出随访明细</button>
        </div>
        <div className="board-summary">
          <div className="summary-item"><span>随访总数</span><strong>{data.total}</strong></div>
          <div className="summary-item"><span>按时完成</span><strong>{data.onTime}</strong></div>
          <div className="summary-item"><span>到诊率</span><strong>{data.rate}%</strong></div>
        </div>
      </div>
    </QueryBoundary>
  );
}
