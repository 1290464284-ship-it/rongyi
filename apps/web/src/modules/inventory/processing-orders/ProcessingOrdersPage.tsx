import { useState } from 'react';
import { Factory, Package, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrdersTab } from './components/OrdersTab';
import { FactoriesTab } from './components/FactoriesTab';
import { ProductsTab } from './components/ProductsTab';
import { StatsTab } from './components/StatsTab';

type Tab = 'orders' | 'factories' | 'products' | 'stats';

export default function ProcessingOrdersPage() {
  const [tab, setTab] = useState<Tab>('orders');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">加工单管理</h1>
      </div>

      <div className="flex gap-2 border-b">
        {[
          { key: 'orders', label: '加工单', icon: Package },
          { key: 'factories', label: '加工厂', icon: Factory },
          { key: 'products', label: '加工产品', icon: Package },
          { key: 'stats', label: '统计', icon: DollarSign },
        ].map(t => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'default' : 'ghost'}
            onClick={() => setTab(t.key as Tab)}
            className="gap-2"
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'orders' && <OrdersTab />}
      {tab === 'factories' && <FactoriesTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}
