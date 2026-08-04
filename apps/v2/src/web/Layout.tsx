import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  LogOut,
  Package,
  BarChart3,
  Phone,
  Receipt,
  Settings,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react';
import { logout } from './api';
import { apiRequest } from './api';

const groups = [
  { key: 'dashboard', label: '工作台', to: '/', icon: LayoutDashboard },
  { key: 'patients', label: '患者与预约', to: '/patients', icon: Users },
  { key: 'clinical', label: '临床记录', to: '/clinical', icon: Stethoscope },
  { key: 'finance', label: '财务中心', to: '/finance', icon: Receipt },
  { key: 'inventory', label: '库存与采购', to: '/inventory', icon: Package },
  { key: 'analytics', label: '经营分析', to: '/analytics', icon: BarChart3 },
  { key: 'communication', label: '随访与沟通', to: '/communication', icon: Phone },
  { key: 'hr', label: '人事与设备', to: '/hr', icon: UserCog },
  { key: 'system', label: '系统管理', to: '/system', icon: Settings },
];

export function Layout() {
  const navigate = useNavigate();
  const navigation = useQuery({
    queryKey: ['navigation'],
    queryFn: () => apiRequest<{ permissions: string[] }>('/auth/navigation'),
  });
  const visibleKeys = navigation.data?.permissions ?? [];
  const visibleGroups = groups.filter((group) => visibleKeys.includes(group.key));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Dental V2</div>
        <nav>
          {visibleGroups.map((group) => {
            const Icon = group.icon;
            return (
              <NavLink key={group.to} to={group.to} end={group.to === '/'}>
                <Icon size={18} />
                {group.label}
              </NavLink>
            );
          })}
        </nav>
        <button
          className="logout"
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut size={18} /> Sign out
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
