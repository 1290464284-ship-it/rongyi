import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Prescription } from '@/lib/api/content/prescriptions';

export function PrescriptionsTab({ prescriptions }: { prescriptions: Prescription[] }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <h2 className="text-sm font-medium mb-2">处方记录</h2>
      {prescriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无处方</p>
      ) : (
        prescriptions.map((rx) => (
          <div key={rx.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">{rx.items.length} 种药品</div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(rx.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
              </div>
            </div>
            <div className="text-xs text-muted-foreground mb-2">医生：{rx.doctor?.name}</div>
            <div className="space-y-1">
              {rx.items.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>{item.drugName} {item.spec}</span>
                  <span className="text-muted-foreground">{item.dosage} {item.frequency} ×{item.days}天</span>
                </div>
              ))}
            </div>
            {rx.remark && (
              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">备注：{rx.remark}</div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
