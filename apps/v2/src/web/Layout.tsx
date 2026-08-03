import { NavLink, Outlet, useNavigate } from 'react-router';
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

const groups = [
  { label: '工作台', to: '/', icon: LayoutDashboard },
  { label: '患者与预约', to: '/patients', icon: Users },
  { label: '临床记录', to: '/clinical', icon: Stethoscope },
  { label: '财务中心', to: '/finance', icon: Receipt },
  { label: '库存与采购', to: '/inventory', icon: Package },
  { label: '经营分析', to: '/analytics', icon: BarChart3 },
  { label: '随访与沟通', to: '/communication', icon: Phone },
  { label: '人事与设备', to: '/hr', icon: UserCog },
  { label: '系统管理', to: '/system', icon: Settings },
];

export function Layout() {
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Dental V2</div>
        <nav>
          {groups.map((group) => {
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
