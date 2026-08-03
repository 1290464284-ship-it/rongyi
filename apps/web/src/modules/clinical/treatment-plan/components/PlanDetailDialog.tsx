import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  TrendingDown,
  Clock,
  Smile,
  User,
  RefreshCw,
  Printer,
} from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState, Spinner } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { cn } from '@/lib/utils';
import {
  useTreatmentProgressDetail,
  PLAN_STATUS,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_COLOR,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_BADGE_CLASS,
  TIMELINE_KIND_LABEL,
  type TreatmentProgressItem,
} from '@/lib/api/clinical/treatment-progress';
import { RingProgress, GENDER_LABEL, SnapshotsLineChart } from './progress-charts';

function PlanDetailDialog({
  open,
  planId,
  onClose,
  onRefresh,
  onPrint,
}: {
  open: boolean;
  planId: string | undefined;
  onClose: () => void;
  onRefresh: (planId: string) => void;
  onPrint: (planId: string) => void;
}) {
  const { data, isLoading, isError, refetch } = useTreatmentProgressDetail(planId, { enabled: open });
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-6xl">
      <DialogHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <DialogTitle>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary" />
              <span>疗程进度详情</span>
              {data?.plan && PLAN_STATUS_COLOR[data.plan.status] && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${PLAN_STATUS_COLOR[data.plan.status]}22`, color: PLAN_STATUS_COLOR[data.plan.status] }}
                >
                  {PLAN_STATUS_LABEL[data.plan.status]}
                </span>
              )}
              {data?.plan && !PLAN_STATUS_COLOR[data.plan.status] && (
                <Badge className="bg-muted">{PLAN_STATUS_LABEL[data.plan.status]}</Badge>
              )}
            </div>
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => planId && onRefresh(planId)}>
              <RefreshCw className="w-4 h-4 mr-1" /> 重算进度
            </Button>
            <Button size="sm" onClick={() => planId && onPrint(planId)}>
              <Printer className="w-4 h-4 mr-1" /> 打印计划
            </Button>
          </div>
        </div>
      </DialogHeader>
      <DialogContent className="space-y-5">
        {isError && <QueryErrorAlert onRetry={refetch} />}
        {isLoading && <div className="text-center py-8"><Spinner /> <span className="ml-2 text-muted-foreground text-sm">加载中…</span></div>}

        {data && (
          <>
            <Card>
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">患者</div>
                  <div className="flex items-center gap-2 font-medium">
                    <span className="w-8 h-8 rounded-full bg-blue-400 flex items-center justify-center text-xs font-medium text-white">
                      {data.plan.patientName.charAt(0)}
                    </span>
                    <span>{data.plan.patientName}</span>
                    <span className="text-xs text-muted-foreground">
                      {GENDER_LABEL[data.plan.patientGender] ?? '未知'} · {data.plan.age}岁
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">主治医生</div>
                  <div className="font-medium flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-muted-foreground" /> {data.plan.doctorName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">目标日期</div>
                  <div className="font-medium">
                    {format(new Date(data.plan.targetDate), 'yyyy-MM-dd', { locale: zhCN })}
                    {data.plan.delayDays > 0 && <span className="ml-2 text-xs text-destructive">滞后 {data.plan.delayDays} 天</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">完成进度</div>
                  <div className="flex items-center gap-3">
                    <RingProgress value={data.plan.completionPct} size={56} />
                    <div className="text-xs text-muted-foreground">
                      <div>已完 {data.plan.completedItems} / 共 {data.plan.totalItems} 项</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-success" /> 治疗项明细
              </h4>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>牙位</TableHead>
                        <TableHead>治疗项</TableHead>
                        <TableHead>编码</TableHead>
                        <TableHead>价格</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>预计天数</TableHead>
                        <TableHead>完成日期</TableHead>
                        <TableHead className="text-right">滞后天数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.length === 0 ? (
                        <EmptyState colSpan={8} text="暂无治疗项" />
                      ) : data.items.map((item: TreatmentProgressItem) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            {item.tooth ? (
                              <Badge className="bg-primary/10 text-primary inline-flex items-center gap-1">
                                <Smile className="w-3 h-3" /> {item.tooth}
                              </Badge>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="font-medium">{item.treatmentName}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{item.treatmentCode}</TableCell>
                          <TableCell className="tabular-nums">¥{Number(item.price).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge className={ITEM_STATUS_BADGE_CLASS[item.status]}>{ITEM_STATUS_LABEL[item.status]}</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">D{item.expectedDay}</TableCell>
                          <TableCell className="text-xs">
                            {item.completedAt
                              ? format(new Date(item.completedAt), 'yyyy-MM-dd', { locale: zhCN })
                              : <span className="text-muted-foreground">预计 D{item.expectedDay}</span>}
                          </TableCell>
                          <TableCell className={cn('tabular-nums text-right', item.daysLag > 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                            {item.daysLag > 0 ? `+${item.daysLag}` : item.daysLag === 0 ? '0' : item.daysLag}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1">
                    <TrendingDown className="w-4 h-4 text-primary" /> 30 日完成度趋势
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SnapshotsLineChart snapshots={data.snapshots} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1">
                    <Clock className="w-4 h-4 text-warning" /> 时间轴
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.timeline.length === 0 ? (
                    <div className="text-center text-muted-foreground py-6 text-sm">暂无事件</div>
                  ) : (
                    <ol className="relative border-l border-border ml-2 space-y-4 max-h-[240px] overflow-auto pr-2">
                      {data.timeline.map((evt, idx) => (
                        <li key={idx} className="ml-4">
                          <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-primary ring-4 ring-white" />
                          <div className="flex items-center justify-between gap-2">
                            <Badge className="bg-primary/10 text-primary text-[10px]">
                              {TIMELINE_KIND_LABEL[evt.kind] ?? evt.kind}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {format(new Date(evt.createdAt), 'MM-dd HH:mm', { locale: zhCN })}
                            </span>
                          </div>
                          <p className="text-sm mt-1 text-foreground">{evt.content}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PlanDetailDialog;
