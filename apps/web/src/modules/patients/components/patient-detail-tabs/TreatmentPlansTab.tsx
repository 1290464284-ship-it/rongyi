import { Badge } from '@/components/ui/badge';
import { PLAN_STATUS_LABEL, PLAN_STATUS_COLOR } from '@/lib/api/clinical/treatment-plans';
import type { TreatmentPlan } from '@/lib/api/clinical/treatment-plans';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function TreatmentPlansTab({ plans }: { plans: TreatmentPlan[] }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <h2 className="text-sm font-medium mb-2">治疗计划</h2>
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无治疗计划</p>
      ) : (
        plans.map((plan) => (
          <div key={plan.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">{plan.title}</div>
              <Badge className={PLAN_STATUS_COLOR[plan.status as keyof typeof PLAN_STATUS_COLOR]}>{PLAN_STATUS_LABEL[plan.status as keyof typeof PLAN_STATUS_LABEL]}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              医生：{plan.doctor?.name} · {plan.items.length} 项 · 预计 ¥{Number(plan.totalPrice).toFixed(2)}
            </div>
            <div className="flex flex-wrap gap-1">
              {plan.items.slice(0, 5).map(item => (
                <Badge key={item.id} className="bg-muted text-muted-foreground">{item.treatmentCatalogName}</Badge>
              ))}
              {plan.items.length > 5 && (
                <Badge className="bg-muted text-muted-foreground">+{plan.items.length - 5}</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {format(new Date(plan.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
