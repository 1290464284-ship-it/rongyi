import { Badge } from '@/components/ui/badge';
import { CHARGE_STATUS_LABEL, CHARGE_STATUS_COLOR, PAY_METHOD_LABEL } from '@/lib/api/financial/charges';
import type { Charge } from '@/lib/types/charge.types';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function ChargesTab({ charges }: { charges: Charge[] }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <h2 className="text-sm font-medium mb-2">收费记录</h2>
      {charges.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无收费记录</p>
      ) : (
        charges.map((c) => (
          <div key={c.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-xs">{c.number}</div>
              <Badge className={CHARGE_STATUS_COLOR[c.status as keyof typeof CHARGE_STATUS_COLOR]}>
                {CHARGE_STATUS_LABEL[c.status as keyof typeof CHARGE_STATUS_LABEL]}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-muted-foreground">
                  {c.items.length} 项
                  {c.payMethod && ` · ${PAY_METHOD_LABEL[c.payMethod as keyof typeof PAY_METHOD_LABEL]}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(c.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-primary">
                  ¥{Number(c.totalAmount).toFixed(2)}
                </div>
                {Number(c.paidAmount) > 0 && Number(c.paidAmount) < Number(c.totalAmount) && (
                  <div className="text-xs text-muted-foreground">
                    已付 ¥{Number(c.paidAmount).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
              {c.items.map(item => (
                <div key={item.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.name}</span>
                  <span>¥{Number(item.subtotal).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
