import { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { navEntries, isGroup, type NavEntry, type NavItem, type Role } from '@/lib/nav';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

/** 过滤角色匹配的条目 */
function filterByRole(entries: NavEntry[], role: Role): NavEntry[] {
  return entries
    .filter((e) => e.roles.includes(role))
    .map((e) => {
      if (isGroup(e)) {
        return { ...e, children: e.children.filter((c) => c.roles.includes(role)) };
      }
      return e;
    })
    // 过滤掉没有可见子项的空分组
    .filter((e) => !isGroup(e) || (e as NavEntry & { children: NavItem[] }).children.length > 0);
}

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // 初始展开包含当前路由的分组
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    navEntries.forEach((e, idx) => {
      if (isGroup(e) && e.children.some((c) => location.pathname.startsWith(c.to))) {
        set.add(String(idx));
      }
    });
    return set;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const entries = user ? filterByRole(navEntries, user.role) : [];

  return (
    <aside className='w-60 shrink-0 bg-gradient-to-b from-primaryDark via-primary to-primary flex flex-col shadow-card relative overflow-hidden'>
      {/* 牙釉质纹理叠加 */}
      <div className='absolute inset-0 opacity-[0.04] pointer-events-none' style={{
        backgroundImage: `radial-gradient(circle at 30% 20%, white 1px, transparent 1px),
          radial-gradient(circle at 70% 40%, white 1.5px, transparent 1.5px),
          radial-gradient(circle at 50% 60%, white 1px, transparent 1px),
          radial-gradient(circle at 20% 80%, white 2px, transparent 2px),
          radial-gradient(circle at 80% 15%, white 1px, transparent 1px),
          radial-gradient(circle at 40% 90%, white 1.5px, transparent 1.5px)`,
        backgroundSize: '100px 100px, 150px 150px, 120px 120px, 200px 200px, 80px 80px, 160px 160px',
      }} />
      {/* 顶部光泽带 */}
      <div className='absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/[0.06] to-transparent pointer-events-none' />
      <div className='h-16 flex items-center justify-center bg-primaryDark border-b border-white/10'>
        <div className='flex items-center gap-2'>
          <div className='w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center'>
            <svg className='w-5 h-5 text-white' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5.5C10.5 4 8.5 3 6.5 3C3.5 3 2 6 2 8.5C2 11.5 4.5 14 7 15.5L12 21L17 15.5C19.5 14 22 11.5 22 8.5C22 6 20.5 3 17.5 3C15.5 3 13.5 4 12 5.5Z" />
              <path d="M12 5.5C13.5 7 15.5 8 17.5 8" />
            </svg>
          </div>
          <span className='text-lg font-bold text-white'>牙科管家</span>
        </div>
      </div>

      <nav className='flex-1 px-3 py-4 space-y-1 overflow-y-auto'>
        {entries.map((entry, idx) => {
          if (!isGroup(entry)) {
            // 独立顶级项
            const item = entry as NavItem;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-white/20 text-white shadow-soft'
                      : 'text-white/80 hover:bg-white/10 hover:text-white',
                  )
                }
              >
                <item.icon className='w-5 h-5' />
                {item.label}
              </NavLink>
            );
          }

          // 分组项
          const group = entry as NavEntry & { label: string; icon: any; children: NavItem[] };
          const key = String(idx);
          const isOpen = expanded.has(key);
          const hasActiveChild = group.children.some((c) => location.pathname.startsWith(c.to));

          return (
            <div key={key}>
              <button
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                aria-label={`${group.label} 分组`}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200',
                  hasActiveChild
                    ? 'text-white'
                    : 'text-white/80 hover:bg-white/10 hover:text-white',
                )}
              >
                <group.icon className='w-5 h-5' aria-hidden="true" />
                <span className='flex-1 text-left'>{group.label}</span>
                <ChevronDown
                  className={cn('w-4 h-4 transition-transform duration-200', isOpen && 'rotate-180')}
                />
              </button>

              {isOpen && (
                <div className='mt-1 ml-5 space-y-1 border-l border-white/10 pl-3'>
                  {group.children.map((child) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200',
                          isActive
                            ? 'bg-white/20 text-white font-medium'
                            : 'text-white/80 hover:bg-white/10 hover:text-white',
                        )
                      }
                    >
                      <child.icon className='w-4 h-4' />
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
