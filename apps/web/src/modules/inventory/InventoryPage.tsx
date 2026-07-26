import React, { useState } from 'react';
import { InventoryListTab } from './components/InventoryListTab';
import { TransactionsTab } from './components/TransactionsTab';
import { LowStockTab } from './components/LowStockTab';

type TabKey = 'list' | 'transactions' | 'lowstock';

const InventoryPage = React.memo(function InventoryPage() {
  const [tab, setTab] = useState<TabKey>('list');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'list', label: '库存列表' },
    { key: 'transactions', label: '出入库记录' },
    { key: 'lowstock', label: '低库存预警' },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">库存管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理库存物资及出入库记录</p>
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

      {tab === 'list' && <InventoryListTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'lowstock' && <LowStockTab />}
    </div>
  );
});
export default InventoryPage;
