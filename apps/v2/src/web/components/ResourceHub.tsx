import { Fragment, Suspense, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ResourcePage } from './ResourcePage';
import type { HubTab } from './hub-tabs';
import { apiRequest } from '../lib/api';
import { ErrorBoundary, LoadingState } from '.';

export function ResourceHub({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultResourceTabId = tabs.find((tab) => tab.kind === 'resource')?.id ?? tabs[0]?.id ?? '';
  const searchTabId = tabs.find((tab) => tab.searchTab)?.id ?? defaultResourceTabId;
  const urlTab = searchParams.get('tab');
  const urlQuery = searchParams.get('q') ?? '';
  const hasQuery = urlQuery !== '';
  const [activeId, setActiveId] = useState(
    urlTab ?? (hasQuery ? searchTabId : tabs[0]?.id ?? ''),
  );
  const [prevUrlTab, setPrevUrlTab] = useState(urlTab);
  const [prevHasQuery, setPrevHasQuery] = useState(hasQuery);
  if (prevUrlTab !== urlTab || prevHasQuery !== hasQuery) {
    setPrevUrlTab(urlTab);
    setPrevHasQuery(hasQuery);
    if (urlTab) setActiveId(urlTab);
    else if (hasQuery) setActiveId(searchTabId);
  }
  const [filter, setFilter] = useState('');
  // M3：只渲染当前活动 tab，切换即卸载非活动页面（display:none 常驻会累积 useQuery 订阅与组件实例）
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const hasBossOnly = tabs.some((tab) => tab.bossOnly);
  const navigation = useQuery({
    // 与 Layout 共用同一键，避免同一 /auth/navigation 被重复请求。
    queryKey: ['navigation'],
    queryFn: () => apiRequest<{ role?: string }>('/auth/navigation'),
    enabled: hasBossOnly,
  });
  const visibleTabs = hasBossOnly
    ? tabs.filter((tab) => !tab.bossOnly || navigation.data?.role === 'BOSS' || navigation.data?.role === 'ADMIN')
    : tabs;
  if (hasBossOnly && navigation.error) {
    return (
      <div className="hub">
        <div className="page-head"><h1>{title}</h1></div>
        <div className="error">导航权限加载失败，无法确定可访问模块</div>
        <button type="button" onClick={() => void navigation.refetch()}>重试</button>
      </div>
    );
  }
  const query = filter.trim().toLowerCase();
  const filteredTabs = query === '' ? visibleTabs : visibleTabs.filter((tab) => tab.label.toLowerCase().includes(query));
  const active = filteredTabs.find((tab) => tab.id === activeId) ?? filteredTabs[0];
  const effectiveActiveId = active?.id ?? '';

  function selectTab(id: string) {
    setActiveId(id);
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % filteredTabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + filteredTabs.length) % filteredTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = filteredTabs.length - 1;
    else return;
    event.preventDefault();
    const target = filteredTabs[next];
    if (!target) return;
    selectTab(target.id);
    tabRefs.current.get(target.id)?.focus();
  }

  return (
    <div className="hub">
      <div className="page-head"><h1>{title}</h1></div>
      {visibleTabs.length > 1 && (
        <div className="hub-toolbar">
          <input
            aria-label={`${title}\u7b5b\u9009`}
            type="search"
            placeholder={'\u641c\u7d22\u9875\u9762\u2026'}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      )}
      {filteredTabs.length === 0 ? (
        <div className="table-empty">没有匹配的页面</div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label={title}>
            {filteredTabs.map((tab, index) => {
              const showGroup = tab.group !== undefined && (index === 0 || filteredTabs[index - 1]?.group !== tab.group);
              return (
                <Fragment key={tab.id}>
                  {showGroup && <span className="tab-group" aria-hidden="true">{tab.group}</span>}
                  <button
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
                </Fragment>
              );
            })}
          </div>
          {active && (
            <div
              key={`${active.id}:${urlQuery}`}
              id={`hub-panel-${active.id}`}
              role="tabpanel"
              aria-labelledby={`hub-tab-${active.id}`}
              className="tab-panel"
            >
              <ErrorBoundary>
                {active.kind === 'resource' ? (
                  <ResourcePage resource={active.resource} initialSearch={urlQuery || undefined} />
                ) : active.kind === 'custom' ? (
                  <Suspense fallback={<LoadingState label="页面加载中" />}>
                    <active.component initialSearch={urlQuery || undefined} />
                  </Suspense>
                ) : null}
              </ErrorBoundary>
            </div>
          )}
        </>
      )}
    </div>
  );
}
