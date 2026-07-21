import { useState } from 'react';
import { FirstExamListTab } from './components/FirstExamListTab';
import { TrackTab } from './components/TrackTab';
import { StatsTab } from './components/StatsTab';

type TabKey = 'list' | 'track' | 'stats';

export default function FirstExamsPage() {
  const [tab, setTab] = useState<TabKey>('list');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'list', label: '首诊列表' },
    { key: 'track', label: '流失追踪' },
    { key: 'stats', label: '统计分析' },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">首诊检查</h1>
          <p className="text-sm text-muted-foreground mt-1">管理首诊检查记录、流失追踪及转化统计</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list' && <FirstExamListTab />}
      {tab === 'track' && <TrackTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}
