import { Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResourcePage } from './ResourcePage';
import type { HubTab } from './hub-tabs';
import { apiRequest } from './api';
import { ErrorBoundary, LoadingState } from './components';

export function ResourceHub({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  // 已访问过的 tab 保持挂载（display 由 hidden 控制），切走再切回不丢搜索/分页/表单状态
  const [visitedIds, setVisitedIds] = useState<Set<string>>(() => new Set([tabs[0]?.id ?? '']));
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const hasBossOnly = tabs.some((tab) => tab.bossOnly);
  const navigation = useQuery({
    queryKey: ['resource-hub-navigation'],
    queryFn: () => apiRequest<{ role?: string }>('/auth/navigation'),
    enabled: hasBossOnly,
  });
  const visibleTabs = hasBossOnly
    ? tabs.filter((tab) => !tab.bossOnly || navigation.data?.role === 'BOSS')
    : tabs;
  const active = visibleTabs.find((tab) => tab.id === activeId) ?? visibleTabs[0];
  const effectiveActiveId = active?.id ?? '';

  function selectTab(id: string) {
    setActiveId(id);
    setVisitedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % visibleTabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visibleTabs.length - 1;
    else return;
    event.preventDefault();
    const target = visibleTabs[next];
    if (!target) return;
    selectTab(target.id);
    tabRefs.current.get(target.id)?.focus();
  }

  // bossOnly 过滤后 active tab 不可见时回退到第一个可见 tab（并补记 visited）
  useEffect(() => {
    if (effectiveActiveId && !visitedIds.has(effectiveActiveId)) {
      setVisitedIds((current) => new Set(current).add(effectiveActiveId));
    }
  }, [effectiveActiveId, visitedIds]);

  const renderedTabs = visibleTabs.filter((tab) => visitedIds.has(tab.id));

  return (
    <div className="hub">
      <h1>{title}</h1>
      <div className="tabs" role="tablist" aria-label={title}>
        {visibleTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.id, node);
              else tabRefs.current.delete(tab.id);
            }}
            id={`hub-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={tab.id === effectiveActiveId}
            aria-controls={`hub-panel-${tab.id}`}
            tabIndex={tab.id === effectiveActiveId ? 0 : -1}
            className={tab.id === effectiveActiveId ? 'tab active' : 'tab'}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {renderedTabs.map((tab) => (
        <div
          key={tab.id}
          id={`hub-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`hub-tab-${tab.id}`}
          className="tab-panel"
          hidden={tab.id !== effectiveActiveId}
        >
          <ErrorBoundary>
            {tab.kind === 'resource' ? (
              <ResourcePage resource={tab.resource} />
            ) : tab.kind === 'custom' ? (
              <Suspense fallback={<LoadingState label="页面加载中" />}>
                <tab.component />
              </Suspense>
            ) : null}
          </ErrorBoundary>
        </div>
      ))}
    </div>
  );
}
