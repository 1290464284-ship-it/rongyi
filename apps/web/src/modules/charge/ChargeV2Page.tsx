/**
 * @deprecated 此页面已合并到 UnifiedChargePage 中，作为"组合 / 欠费"标签页使用。
 * 请勿直接在路由中使用此页面，应通过 UnifiedChargePage 访问。
 */
import { useState } from 'react';
import { Package, CreditCard, AlertCircle } from 'lucide-react';
import { ChargeCombosTab } from './components/combos/CombosTab';
import { PaymentMethodsTab } from './components/payments/PaymentMethodsTab';
import { DebtsTab } from './components/payments/DebtsTab';

type TabType = 'combos' | 'payment-methods' | 'debts';

const TABS: { key: TabType; label: string; icon: typeof Package }[] = [
  { key: 'combos', label: '收费组合', icon: Package },
  { key: 'payment-methods', label: '缴费方式', icon: CreditCard },
  { key: 'debts', label: '欠费管理', icon: AlertCircle },
];

export default function ChargeV2Page() {
  const [activeTab, setActiveTab] = useState<TabType>('combos');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">收费增强</h1>
          <p className="text-sm text-muted-foreground mt-1">收费组合、缴费方式、欠费管理</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
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

      {activeTab === 'combos' && <ChargeCombosTab />}
      {activeTab === 'payment-methods' && <PaymentMethodsTab />}
      {activeTab === 'debts' && <DebtsTab />}
    </div>
  );
}
