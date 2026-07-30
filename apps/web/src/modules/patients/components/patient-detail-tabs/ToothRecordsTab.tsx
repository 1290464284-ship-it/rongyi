import { Badge } from '@/components/ui/badge';
import type { ToothRecord } from '@/lib/api/content/tooth-records';

export function ToothRecordsTab({ teeth }: { teeth: ToothRecord[] }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-2">
      <h2 className="text-sm font-medium mb-2">牙位记录详情</h2>
      {(teeth ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无牙位记录</p>
      ) : (
        (teeth ?? []).map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold w-8">{t.toothNumber}</span>
              <Badge className="bg-muted text-muted-foreground">{t.currentStatus}</Badge>
              {t.conditions.map((c) => (
                <Badge key={c} className="bg-primary/10 text-primary">{c}</Badge>
              ))}
            </div>
            {t.remark && <span className="text-xs text-muted-foreground">{t.remark}</span>}
          </div>
        ))
      )}
    </div>
  );
}
