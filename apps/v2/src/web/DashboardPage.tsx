import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';

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

  if (isLoading) return <div className="page">Loading...</div>;
  if (error || !data) return <div className="page error">{(error as Error)?.message ?? 'Failed to load dashboard'}</div>;

  const cards = [
    ['Patients', data.patients],
    ['Appointments', data.appointments],
    ['Paid (cents)', data.paidAmount],
    ['Unpaid (cents)', data.unpaidAmount],
    ['Inventory', data.inventoryItems],
    ['Pending follow-ups', data.pendingFollowUps],
  ];

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="cards">
        {cards.map(([label, value]) => (
          <div className="card" key={String(label)}>
            <strong>{label}</strong>
            <span>{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

