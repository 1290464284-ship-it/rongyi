import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import { logout, onSessionExpired, switchClinic } from './api';
import { apiRequest } from './api';
import { useToast } from './toast-context';

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
  const location = useLocation();
  const { showToast } = useToast();
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  useEffect(() => {
    // 会话失效（401 且刷新失败）时全局登出并跳转登录页
    const unsubscribe = onSessionExpired(() => {
      showToast('登录状态已失效，请重新登录', 'error');
      void logout().catch(() => {});
      navigate('/login', { replace: true });
    });
    return unsubscribe;
  }, [navigate, showToast]);
  const navigation = useQuery({
    queryKey: ['navigation'],
    queryFn: () => apiRequest<{ permissions: string[] }>('/auth/navigation'),
  });
  const clinics = useQuery({
    queryKey: ['clinics'],
    queryFn: () => apiRequest<{
      currentClinicId: string | null;
      clinics: Array<{ clinicId: string; name: string }>;
    }>('/auth/clinics'),
  });
  const visibleKeys = navigation.data?.permissions ?? [];
  const visibleGroups = groups.filter((group) => visibleKeys.includes(group.key));

  if (navigation.isLoading) return <div className="page">加载中...</div>;
  if (navigation.error) {
    return (
      <div className="page">
        <p className="error">无法加载导航权限，请稍后重试</p>
        <button onClick={() => void navigation.refetch()}>重试</button>
      </div>
    );
  }
  const currentAllowed = visibleGroups.some((group) => group.to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(group.to));
  if (!currentAllowed) {
    return (
      <div className="page">
        <h1>无访问权限</h1>
        <p>您没有权限查看此模块。</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">口腔诊所管理</div>
        {clinics.data && clinics.data.clinics.length > 1 && (
          <select
            className="clinic-switch"
            aria-label="当前诊所"
            value={selectedClinicId ?? clinics.data.currentClinicId ?? ''}
            onChange={async (event) => {
              const newValue = event.target.value;
              const oldValue = clinics.data.currentClinicId ?? '';
              setSelectedClinicId(newValue);
              try {
                await switchClinic(newValue);
                window.location.reload();
              } catch (error) {
                showToast(error instanceof Error ? error.message : '切换诊所失败', 'error');
                setSelectedClinicId(oldValue);
              }
            }}
          >
            {clinics.data.clinics.map((clinic) => (
              <option key={clinic.clinicId} value={clinic.clinicId}>{clinic.name}</option>
            ))}
          </select>
        )}
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
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut size={18} /> 退出登录
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
