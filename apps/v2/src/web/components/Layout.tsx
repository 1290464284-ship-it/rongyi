import { FormEvent, useEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Package,
  PanelLeft,
  BarChart3,
  Phone,
  Receipt,
  Settings,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react';
import { Logo } from './Logo';
import { logout, onSessionExpired, switchClinic } from '../lib/api';
import { apiRequest } from '../lib/api';
import { useToast } from '../lib/toast-context';
import type { ResourceDefinition } from '../lib/types';
import { Tooltip } from './Tooltip';
import { GlobalSearchForm } from './GlobalSearchForm';
import { BackupStatusCard } from './BackupStatusCard';
import { HelpDialogs } from './HelpDialogs';

interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ComponentType<{ size?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', to: '/', icon: LayoutDashboard },
  { key: 'frontDesk', label: '前台工作', to: '/front-desk', icon: CalendarDays },
  { key: 'patients', label: '患者档案', to: '/patients', icon: Users },
  { key: 'clinical', label: '临床记录', to: '/clinical', icon: Stethoscope },
  { key: 'finance', label: '财务中心', to: '/finance', icon: Receipt },
  { key: 'inventory', label: '库存与采购', to: '/inventory', icon: Package },
  { key: 'analytics', label: '经营分析', to: '/analytics', icon: BarChart3 },
  { key: 'communication', label: '随访与沟通', to: '/communication', icon: Phone },
  { key: 'hr', label: '人事与设备', to: '/hr', icon: UserCog },
  { key: 'system', label: '系统管理', to: '/system', icon: Settings },
];

const NAV_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: '常用', keys: ['dashboard', 'frontDesk', 'patients', 'clinical'] },
  { label: '运营', keys: ['finance', 'inventory', 'analytics', 'communication'] },
  { label: '管理', keys: ['hr', 'system'] },
];

function readOnboardingDone(): boolean {
  try {
    return localStorage.getItem('v2-onboarding-done') === '1';
  } catch {
    // 隐私模式/存储被禁用时按“未完成新手引导”处理，不阻塞应用。
    return false;
  }
}

function markOnboardingDone(): void {
  try {
    localStorage.setItem('v2-onboarding-done', '1');
  } catch {
    // 存储不可用时忽略，不影响主流程。
  }
}

function titleForPath(pathname: string): string {
  const item = NAV_ITEMS.find((entry) => (entry.to === '/' ? pathname === '/' : pathname.startsWith(entry.to)));
  return item?.label ?? '蓉易口腔诊所';
}

function backupTimeLabel(value: unknown): string {
  if (!value) return '暂无备份时间';
  const timestamp = Date.parse(String(value));
  if (Number.isNaN(timestamp)) return String(value);
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(readOnboardingDone);
  useEffect(() => {
    // 会话失效（401 且刷新失败）时全局登出并跳转登录页
    const unsubscribe = onSessionExpired(() => {
      showToast('登录状态已失效，请重新登录', 'error');
      void logout().catch(() => {});
      navigate('/login', { replace: true });
    });
    return unsubscribe;
  }, [navigate, showToast]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      const tag = (event.target as HTMLElement | null)?.tagName ?? '';
      if (event.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        event.preventDefault();
        setShowHelp(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
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
  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/backups'),
    enabled: navigation.data?.role === 'BOSS' || navigation.data?.role === 'ADMIN',
    retry: false,
  });
  const latestBackup = [...(backups.data ?? [])]
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
  const backupTime = backupTimeLabel(latestBackup?.createdAt);
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
    <>
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo variant="sidebar" width={190} height={40} className="sidebar-logo" />
          <span className="visually-hidden">蓉易口腔诊所</span>
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <BackupStatusCard
          hasBackups={Boolean(backups.data?.length)}
          isLoading={backups.isLoading}
          isError={backups.isError}
          timeLabel={backupTime}
          onOpenBackups={() => navigate('/system')}
        />
        <button
          className="logout"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut size={18} /><span>退出登录</span>
        </button>
      </aside>
      <div className="shell-main" id="main-content" role="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-btn" aria-label="收起侧栏" onClick={() => setCollapsed((value) => !value)}>
              <PanelLeft size={18} />
            </button>
            <div>
              <div className="topbar-title">{titleForPath(location.pathname)}</div>
            </div>
          </div>
          <GlobalSearchForm
            value={globalSearch}
            onChange={setGlobalSearch}
            onSubmit={submitGlobalSearch}
            inputRef={searchInputRef}
          />
          <div className="topbar-actions">
            <Tooltip content="通知">
              <button className="icon-btn" aria-label="通知" onClick={() => showToast('暂无新通知', 'info')}>
                <Bell size={18} />
              </button>
            </Tooltip>
            <Tooltip content="帮助">
              <button className="icon-btn" aria-label="帮助" onClick={() => setShowHelp(true)}>
                <CircleHelp size={18} />
              </button>
            </Tooltip>
          </div>
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
      <HelpDialogs
        showHelp={showHelp}
        showOnboarding={showOnboarding}
        onCloseHelp={() => setShowHelp(false)}
        onCloseOnboarding={() => {
          markOnboardingDone();
          setShowOnboarding(false);
        }}
        onReopenOnboarding={() => {
          setShowHelp(false);
          setShowOnboarding(true);
        }}
      />
    </>
  );
}
