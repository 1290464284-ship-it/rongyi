import { useState } from 'react';
import { BarChart3, FileText, ListTodo, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { WorkbenchTab } from './components/WorkbenchTab';
import { TemplatesTab } from './components/TemplatesTab';
import { ItemsTab } from './components/ItemsTab';
import { AutoRulesTab } from './components/AutoRulesTab';
import { StatsTab } from './components/StatsTab';

type TabType = 'workbench' | 'templates' | 'items' | 'auto-rules' | 'stats';

const TABS: { key: TabType; label: string; icon: typeof ListTodo }[] = [
  { key: 'workbench', label: '回访工作台', icon: ListTodo },
  { key: 'templates', label: '回访模板', icon: FileText },
  { key: 'items', label: '回访项目', icon: ListTodo },
  { key: 'auto-rules', label: '自动规则', icon: Settings },
  { key: 'stats', label: '统计分析', icon: BarChart3 },
];

export default function FollowUpsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('workbench');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">回访管理</h1>
      </div>

      <Card>
        <CardHeader className="pb-0">
          <div className="flex gap-1 border-b border-border -mx-6 px-6">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {activeTab === 'workbench' && <WorkbenchTab />}
          {activeTab === 'templates' && <TemplatesTab />}
          {activeTab === 'items' && <ItemsTab />}
          {activeTab === 'auto-rules' && <AutoRulesTab />}
          {activeTab === 'stats' && <StatsTab />}
        </CardContent>
      </Card>
    </div>
  );
}
