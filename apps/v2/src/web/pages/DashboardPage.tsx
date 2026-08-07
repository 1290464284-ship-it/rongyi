import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { formatMoney } from '../lib/format';
import { QueryBoundary } from '../components';

interface DashboardData {
  patients: number;
  appointments: number;
  paidAmount: number;
  unpaidAmount: number;
  inventoryItems: number;
  pendingFollowUps: number;
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest<DashboardData>('/stats/dashboard'),
  });

  return (
    <QueryBoundary isLoading={isLoading} error={error} data={data} errorLabel="无法加载工作台数据">
      <DashboardContent data={data!} />
    </QueryBoundary>
  );
}

function DashboardContent({ data }: { data: DashboardData }) {
  return (
    <div className="page">
      <h1>工作台</h1>
      <div className="stat-cards">
        {([
          ['患者数', String(data.patients)],
          ['预约数', String(data.appointments)],
          ['已收金额', formatMoney(data.paidAmount)],
          ['未收金额', formatMoney(data.unpaidAmount)],
          ['库存项目', String(data.inventoryItems)],
          ['待随访', String(data.pendingFollowUps)],
        ] as const).map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
