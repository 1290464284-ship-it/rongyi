import { lazy, Suspense, useState } from 'react';
import { Receipt, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const ChargePage = lazy(() => import('@/modules/charge/ChargePage'));
const ChargeV2Page = lazy(() => import('./ChargeV2Page'));

type Tab = 'cashier' | 'advanced';

/**
 * 收费统一入口：收银（原 charge）+ 组合/欠费（原 charge-v2）
 */
export default function UnifiedChargePage() {
  const [tab, setTab] = useState<Tab>('cashier');

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b bg-background px-4 pt-3">
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-medium',
            tab === 'cashier'
              ? 'border border-b-0 border-border bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('cashier')}
        >
          <Receipt className="h-4 w-4" />
          收银收费
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-medium',
            tab === 'advanced'
              ? 'border border-b-0 border-border bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('advanced')}
        >
          <Package className="h-4 w-4" />
          组合 / 欠费
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Suspense fallback={<div className="p-6 text-center text-muted-foreground">加载中...</div>}>
          {tab === 'cashier' ? <ChargePage /> : <ChargeV2Page />}
        </Suspense>
      </div>
    </div>
  );
}
