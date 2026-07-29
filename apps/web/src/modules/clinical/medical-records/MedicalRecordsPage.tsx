import { useState } from 'react';
import { FileText, FolderOpen, MessageSquare, FileCheck } from 'lucide-react';
import { RecordsTab } from './components/RecordsTab';
import { TemplatesTab } from './components/TemplatesTab';
import { PhrasesTab } from './components/PhrasesTab';
import { RequestsTab } from './components/RequestsTab';

type TabType = 'records' | 'templates' | 'phrases' | 'requests';

const TABS: { key: TabType; label: string; icon: typeof FileText }[] = [
  { key: 'records', label: '病历管理', icon: FileText },
  { key: 'templates', label: '病历模板', icon: FolderOpen },
  { key: 'phrases', label: '常用短语', icon: MessageSquare },
  { key: 'requests', label: '修改申请', icon: FileCheck },
];

export default function MedicalRecordsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('records');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">电子病历</h1>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
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

      {activeTab === 'records' && <RecordsTab />}
      {activeTab === 'templates' && <TemplatesTab />}
      {activeTab === 'phrases' && <PhrasesTab />}
      {activeTab === 'requests' && <RequestsTab />}
    </div>
  );
}
