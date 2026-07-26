import { useMemo } from 'react';
import { ListTodo, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ITEM_STATUS_LABEL,
  ITEM_STATUS_COLOR,
  type TreatmentPlan,
  type PlanItemStatus,
} from '@/lib/api/clinical/treatment-plans';

export function AggregateView({
  plan,
  onItemStatusChange,
}: {
  plan: TreatmentPlan;
  onItemStatusChange: (itemId: string, status: PlanItemStatus) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof plan.items>();
    for (const item of plan.items) {
      const cat = item.category || '未分类';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries());
  }, [plan.items]);

  const completedCount = plan.items.filter(i => i.status === 'COMPLETED' || i.status === 'SKIPPED').length;
  const progress = plan.items.length > 0 ? Math.round((completedCount / plan.items.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ListTodo className="w-5 h-5 text-muted-foreground" />
        <span className="font-medium">治疗进度</span>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-success transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground w-16 text-right">
          {completedCount}/{plan.items.length}
        </span>
      </div>

      <div className="space-y-3">
        {grouped.map(([category, items]) => {
          const catTotal = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
          const catCompleted = items.filter(i => i.status === 'COMPLETED' || i.status === 'SKIPPED').length;
          return (
            <div key={category} className="border border-border rounded-md overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50">
                <div className="flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{category}</span>
                  <span className="text-xs text-muted-foreground">
                    {catCompleted}/{items.length} 项
                  </span>
                </div>
                <span className="text-sm font-medium">¥{catTotal.toFixed(2)}</span>
              </div>
              <div className="divide-y divide-border/50">
                {items.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between px-4 py-2 hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          item.status === 'COMPLETED'
                            ? 'bg-success'
                            : item.status === 'IN_PROGRESS'
                            ? 'bg-warning'
                            : item.status === 'SKIPPED'
                            ? 'bg-muted'
                            : 'bg-border'
                        }`}
                      />
                      <div>
                        <div className={`text-sm ${item.status === 'SKIPPED' ? 'line-through text-muted-foreground' : ''}`}>
                          {item.name}
                        </div>
                        {(item.teethNumbers ?? []).length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            牙位：{(item.teethNumbers ?? []).join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        ¥{Number(item.price).toFixed(2)} × {item.quantity}
                      </span>
                      {(plan.status === 'IN_PROGRESS' || plan.status === 'APPROVED') && (
                        <Select
                          value={item.status}
                          onChange={e => onItemStatusChange(item.id || '', e.target.value as PlanItemStatus)}
                          className="w-24 text-xs"
                        >
                          <option value="PLANNED">待执行</option>
                          <option value="IN_PROGRESS">进行中</option>
                          <option value="COMPLETED">已完成</option>
                          <option value="SKIPPED">已跳过</option>
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DetailView({ plan }: { plan: TreatmentPlan }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">序号</TableHead>
            <TableHead>项目编码</TableHead>
            <TableHead>项目名称</TableHead>
            <TableHead>类别</TableHead>
            <TableHead>牙位</TableHead>
            <TableHead className="text-right">单价</TableHead>
            <TableHead className="text-right">数量</TableHead>
            <TableHead className="text-right">小计</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.items.map((item, idx) => (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
              <TableCell className="font-mono text-xs">{item.code}</TableCell>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell className="text-muted-foreground">{item.category}</TableCell>
              <TableCell>
                {(item.teethNumbers ?? []).length > 0 ? (item.teethNumbers ?? []).join(', ') : '-'}
              </TableCell>
              <TableCell className="text-right">¥{Number(item.price).toFixed(2)}</TableCell>
              <TableCell className="text-right">{item.quantity}</TableCell>
              <TableCell className="text-right font-medium">
                ¥{(Number(item.price) * item.quantity).toFixed(2)}
              </TableCell>
              <TableCell>
                <Badge className={ITEM_STATUS_COLOR[item.status || 'PENDING']}>
                  {ITEM_STATUS_LABEL[item.status || 'PENDING']}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/30">
            <TableCell colSpan={7} className="text-right font-medium">合计</TableCell>
            <TableCell className="text-right font-bold text-primary">
              ¥{Number(plan.totalFee).toFixed(2)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
