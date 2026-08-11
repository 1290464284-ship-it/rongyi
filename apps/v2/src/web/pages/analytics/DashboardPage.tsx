import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, Package, PhoneCall, Stethoscope, Users, Wallet } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { QueryBoundary } from '../../components';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '../../lib/labels';

interface DashboardData {
  patients: number;
  appointments: number;
  paidAmount: number;
  unpaidAmount: number;
  inventoryItems: number;
  pendingFollowUps: number;
}

interface WorkbenchAppointment {
  id: string;
  patientName?: string | null;
  doctorName?: string | null;
  startTime?: string | null;
  status?: string | null;
  type?: string | null;
}

interface WorkbenchData {
  date?: string;
  appointments?: WorkbenchAppointment[];
  truncated?: { appointments?: boolean };
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest<DashboardData>('/stats/dashboard'),
  });
  const workbench = useQuery({
    queryKey: ['workbench', 'today'],
    queryFn: () => apiRequest<WorkbenchData>('/workbench/today'),
  });

  return (
    <QueryBoundary isLoading={isLoading} error={error} data={data} errorLabel="无法加载工作台数据">
      <DashboardContent data={data!} workbench={workbench.data} workbenchLoading={workbench.isLoading} />
    </QueryBoundary>
  );
}

function DashboardContent({ data, workbench, workbenchLoading }: { data: DashboardData; workbench?: WorkbenchData; workbenchLoading: boolean }) {
  const appointments = Array.isArray(workbench?.appointments) ? workbench.appointments : [];
  const stats = [
    { label: '患者数', value: String(data.patients), icon: Users },
    { label: '预约数', value: String(data.appointments), icon: CalendarDays },
    { label: '已收金额', value: formatMoney(data.paidAmount), icon: Wallet },
    { label: '未收金额', value: formatMoney(data.unpaidAmount), icon: Clock },
    { label: '库存项目', value: String(data.inventoryItems), icon: Package },
    { label: '待随访', value: String(data.pendingFollowUps), icon: PhoneCall },
  ];
  return (
    <div className="page dashboard-page">
      <div className="page-head">
        <div>
          <h1>工作台</h1>
          <p>今日经营概览</p>
        </div>
      </div>
      <div className="stat-cards">
        {stats.map(({ label, value, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <div className="stat-card-top">
              <span className="stat-icon"><Icon size={18} /></span>
            </div>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="card">
          <div className="card-head"><h2>快捷操作</h2></div>
          <div className="quick-action-list">
            <a href="#/patients"><Users size={18} />患者档案</a>
            <a href="#/clinical"><Stethoscope size={18} />临床记录</a>
            <a href="#/finance"><Wallet size={18} />财务中心</a>
            <a href="#/inventory"><Package size={18} />库存与采购</a>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>待办提醒</h2></div>
          <div className="todo-list">
            <div className="todo-item">
              <span className="todo-icon warning"><Clock size={16} /></span>
              <div><strong>待随访 {data.pendingFollowUps} 项</strong><span>请及时安排回访</span></div>
            </div>
            <div className="todo-item">
              <span className="todo-icon primary"><Package size={16} /></span>
              <div><strong>库存项目 {data.inventoryItems} 项</strong><span>当前在库项目数</span></div>
            </div>
          </div>
        </div>
      </div>
      <div className="card today-appointments-card">
        <div className="card-head">
          <h2>今日预约</h2>
          <span className="sub">{appointments.length} 位患者</span>
          {workbench?.truncated?.appointments && <span className="reminder-muted">超过 100 条，仅显示前 100 条</span>}
        </div>
        <div className="appointment-scroll">
          {workbenchLoading ? (
            <div className="table-empty">加载中...</div>
          ) : appointments.length === 0 ? (
            <div className="table-empty">今日暂无预约</div>
          ) : (
            appointments.map((item) => (
              <div className="appointment-row" key={item.id}>
                <span className="appointment-time">{item.startTime?.slice(11, 16) ?? '--:--'}</span>
                <div className="appointment-main">
                  <strong>{item.patientName ?? '未知患者'}</strong>
                  <span>
                    {item.doctorName ?? '未分配医生'} · {APPOINTMENT_TYPE_LABELS[String(item.type ?? '')] ?? item.type ?? '预约'}
                  </span>
                </div>
                <span className="status arrived">
                  {APPOINTMENT_STATUS_LABELS[String(item.status ?? '')] ?? item.status ?? '已预约'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
