import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResourcePage } from './ResourcePage';
import type { HubTab } from './hub-tabs';
import { apiRequest } from './api';
import { ErrorBoundary, LoadingState } from './components';

export function ResourceHub({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
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

  return (
    <div className="hub">
      <h1>{title}</h1>
      <div className="tabs" role="tablist">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            className={tab.id === active?.id ? 'tab active' : 'tab'}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        <ErrorBoundary key={active?.id ?? 'none'}>
          {active?.kind === 'resource' ? (
            <ResourcePage key={active.resource} resource={active.resource} />
          ) : active?.kind === 'custom' ? (
            <Suspense fallback={<LoadingState label="页面加载中" />}>
              <active.component />
            </Suspense>
          ) : null}
        </ErrorBoundary>
      </div>
    </div>
  );
}
