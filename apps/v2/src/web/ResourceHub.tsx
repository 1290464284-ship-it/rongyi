import { useState } from 'react';
import { ResourcePage } from './ResourcePage';
import type { HubTab } from './hub-tabs';

export function ResourceHub({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div className="hub">
      <h1>{title}</h1>
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
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
        {active?.kind === 'resource' ? (
          <ResourcePage key={active.resource} resource={active.resource} />
        ) : active?.kind === 'custom' ? (
          <active.component />
        ) : null}
      </div>
    </div>
  );
}
