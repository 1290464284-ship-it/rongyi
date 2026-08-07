import { FormEvent, useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
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
import { logout, onSessionExpired, switchClinic } from './api';
import { apiRequest } from './api';
import { useToast } from './toast-context';
import type { ResourceDefinition } from './types';

interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ComponentType<{ size?: number }>;
}

const NAV_ITEMS: NavItem[] = [
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

const NAV_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: '常用', keys: ['dashboard', 'patients', 'clinical', 'finance', 'inventory'] },
  { label: '更多', keys: ['analytics', 'communication', 'hr', 'system'] },
];

function titleForPath(pathname: string): string {
  const item = NAV_ITEMS.find((entry) => (entry.to === '/' ? pathname === '/' : pathname.startsWith(entry.to)));
  return item?.label ?? '蓉易口腔诊所';
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
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
    queryFn: () => apiRequest<{ permissions: string[]; role?: string }>('/auth/navigation'),
  });
  // /resources/:resource 深链不在 NAV_ITEMS 内，需按资源定义的 roles 校验角色
  const resourceMatch = location.pathname.match(/^\/resources\/([^/]+)/);
  const resourceName = resourceMatch ? decodeURIComponent(resourceMatch[1]) : null;
  const resourceMeta = useQuery({
    queryKey: ['resource-meta'],
    queryFn: () => apiRequest<ResourceDefinition[]>('/resource-meta'),
    enabled: resourceName !== null,
  });
  const clinics = useQuery({
    queryKey: ['clinics'],
    queryFn: () => apiRequest<{
      currentClinicId: string | null;
      clinics: Array<{ clinicId: string; name: string }>;
    }>('/auth/clinics'),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => apiRequest<{ name?: string; username: string }>('/auth/me'),
  });
  const visibleKeys = navigation.data?.permissions ?? [];
  const visibleItems = NAV_ITEMS.filter((item) => visibleKeys.includes(item.key));

  function submitGlobalSearch(event: FormEvent) {
    event.preventDefault();
    const q = globalSearch.trim();
    navigate(q ? `/patients?q=${encodeURIComponent(q)}` : '/patients');
    setGlobalSearch('');
  }

  if (navigation.isLoading) return <div className="page">加载中...</div>;
  if (navigation.error) {
    return (
      <div className="page">
        <p className="error">无法加载导航权限，请稍后重试</p>
        <button onClick={() => void navigation.refetch()}>重试</button>
      </div>
    );
  }
  if (resourceName !== null && resourceMeta.isLoading) return <div className="page">加载中...</div>;
  if (resourceName !== null && resourceMeta.error) {
    return (
      <div className="page">
        <p className="error">无法加载资源信息，请稍后重试</p>
        <button onClick={() => void resourceMeta.refetch()}>重试</button>
      </div>
    );
  }
  let resourceAllowed = true;
  if (resourceName !== null) {
    const definition = resourceMeta.data?.find((entry) => entry.name === resourceName);
    const role = navigation.data?.role ?? '';
    resourceAllowed = Boolean(definition && (definition.roles ?? []).some((allowed) => allowed === role));
  }
  const currentAllowed = resourceName !== null
    ? resourceAllowed
    : visibleItems.some((group) => group.to === '/'
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
        <div className="sidebar-brand">
          <span className="sidebar-logo" aria-hidden="true" />
          蓉易口腔诊所
        </div>
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
          {NAV_GROUPS.map((group) => {
            const items = group.keys
              .map((key) => visibleItems.find((item) => item.key === key))
              .filter((item): item is NavItem => Boolean(item));
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="sidebar-group-wrap">
                <div className="sidebar-group">{group.label}</div>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                      <Icon size={18} />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
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
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-title">{titleForPath(location.pathname)}</div>
          <form onSubmit={submitGlobalSearch} role="search">
            <input
              className="topbar-search"
              type="search"
              placeholder="搜索患者…"
              aria-label="全局搜索"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
          </form>
          <div className="topbar-user">
            <span className="avatar" aria-hidden="true" />
            {me.data ? (me.data.name || me.data.username) : ''}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
