import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
import { TableLoading, EmptyState } from '@/components/ui/loading';
import {
  useTreatmentPlans,
  useCreateTreatmentPlan,
  useDeleteTreatmentPlan,
  useUpdatePlanStatus,
  useUpdatePlanItemStatus,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_COLOR,
  type TreatmentPlan,
  type PlanStatus,
  type PlanItemStatus,
} from '@/lib/api/clinical/treatment-plans';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { CreateTreatmentPlanDialog } from './components/CreateTreatmentPlanDialog';
import { AggregateView, DetailView } from './components/PlanDetailViews';

export default function TreatmentPlanPage() {
  const [searchParams] = useSearchParams();
  const presetPatientId = searchParams.get('patientId') ?? '';
  const presetVisitId = searchParams.get('visitId') ?? '';

  const [statusFilter, setStatusFilter] = useState<PlanStatus | ''>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<TreatmentPlan | null>(null);
  const [viewMode, setViewMode] = useState<'aggregate' | 'detail'>('aggregate');
  const [createOpen, setCreateOpen] = useState(() => !!presetPatientId);

  const { data, isLoading } = useTreatmentPlans({
    status: statusFilter || undefined,
    page,
    pageSize,
  });

  const createPlan = useCreateTreatmentPlan();
  const deletePlan = useDeleteTreatmentPlan();
  const updateStatus = useUpdatePlanStatus();
  const updateItemStatus = useUpdatePlanItemStatus();

  const plans = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filtered = useMemo(() => {
    if (!keyword) return plans;
    const kw = keyword.toLowerCase();
    return plans.filter(
      p =>
        (p.name || p.title || '').toLowerCase().includes(kw) ||
        p.patient?.name?.toLowerCase().includes(kw) ||
        p.doctor?.name?.toLowerCase().includes(kw),
    );
  }, [plans, keyword]);

  function handleView(plan: TreatmentPlan) {
    setSelectedPlan(plan);
    setDetailOpen(true);
  }

  function handleDelete(id: string) {
    if (!confirm('确定删除该治疗计划？')) return;
    deletePlan.mutate(id);
  }

  function handleStatusChange(plan: TreatmentPlan, status: PlanStatus) {
    updateStatus.mutate({ id: plan.id, status });
    if (selectedPlan?.id === plan.id) {
      setSelectedPlan({ ...selectedPlan, status });
    }
  }

  function handleItemStatusChange(planId: string, itemId: string, status: PlanItemStatus) {
    updateItemStatus.mutate({ id: planId, itemId, status });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">治疗计划</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建计划
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索计划名称/患者/医生"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as PlanStatus | '');
                setPage(1);
              }}
              className="w-36"
            >
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="SUBMITTED">已提交</option>
              <option value="APPROVED">已批准</option>
              <option value="REJECTED">已驳回</option>
              <option value="IN_PROGRESS">进行中</option>
              <option value="COMPLETED">已完成</option>
              <option value="CANCELLED">已取消</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>计划名称</TableHead>
                <TableHead>患者</TableHead>
                <TableHead>医生</TableHead>
                <TableHead>项目数</TableHead>
                <TableHead>总费用</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={8} />
              ) : filtered.length === 0 ? (
                <EmptyState colSpan={8} text="暂无数据" />
              ) : (
                filtered.map(plan => (
                  <TableRow key={plan.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleView(plan)}>
                    <TableCell className="font-medium">{plan.name || plan.title || '-'}</TableCell>
                    <TableCell>{plan.patient?.name}</TableCell>
                    <TableCell>{plan.doctor?.name}</TableCell>
                    <TableCell>{plan._count?.items ?? plan.items.length} 项</TableCell>
                    <TableCell className="font-semibold">¥{Number(plan.totalFee).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={PLAN_STATUS_COLOR[plan.status]}>
                        {PLAN_STATUS_LABEL[plan.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(plan.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-right space-x-2" onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="outline" onClick={() => handleView(plan)}>
                        <Eye className="w-3 h-3 mr-1" />
                        查看
                      </Button>
                      {(plan.status === 'DRAFT' || plan.status === 'CANCELLED') && (
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(plan.id)} disabled={deletePlan.isPending}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                          {deletePlan.isPending ? '删除中…' : ''}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPlan && (
        <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} className="max-w-4xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                <span className="mr-3">{selectedPlan.name}</span>
                <Badge className={PLAN_STATUS_COLOR[selectedPlan.status]}>
                  {PLAN_STATUS_LABEL[selectedPlan.status]}
                </Badge>
              </DialogTitle>
              <div className="flex items-center gap-2">
                <div className="flex bg-muted rounded-md p-0.5">
                  <button
                    className={`px-3 py-1 text-xs rounded ${viewMode === 'aggregate' ? 'bg-white shadow-sm' : ''}`}
                    onClick={() => setViewMode('aggregate')}
                  >
                    聚合视图
                  </button>
                  <button
                    className={`px-3 py-1 text-xs rounded ${viewMode === 'detail' ? 'bg-white shadow-sm' : ''}`}
                    onClick={() => setViewMode('detail')}
                  >
                    明细视图
                  </button>
                </div>
              </div>
            </div>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">患者</div>
                  <div className="font-medium">{selectedPlan.patient?.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">主治医生</div>
                  <div className="font-medium">{selectedPlan.doctor?.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">项目总数</div>
                  <div className="font-medium">{selectedPlan.items.length} 项</div>
                </div>
                <div>
                  <div className="text-muted-foreground">预计总费用</div>
                  <div className="font-medium text-primary">¥{Number(selectedPlan.totalFee).toFixed(2)}</div>
                </div>
              </div>

              {viewMode === 'aggregate' ? (
                <AggregateView
                  plan={selectedPlan}
                  onItemStatusChange={(itemId, status) => handleItemStatusChange(selectedPlan.id, itemId, status)}
                />
              ) : (
                <DetailView plan={selectedPlan} />
              )}

              <div className="flex justify-between items-center pt-4 border-t border-border">
                <div className="flex gap-2">
                  {selectedPlan.status === 'DRAFT' && (
                    <Button size="sm" onClick={() => handleStatusChange(selectedPlan, 'APPROVED')} disabled={updateStatus.isPending}>
                      <Check className="w-4 h-4 mr-1" />
                      {updateStatus.isPending ? '处理中…' : '审批通过'}
                    </Button>
                  )}
                  {selectedPlan.status === 'APPROVED' && (
                    <Button size="sm" onClick={() => handleStatusChange(selectedPlan, 'IN_PROGRESS')} disabled={updateStatus.isPending}>
                      {updateStatus.isPending ? '处理中…' : '开始治疗'}
                    </Button>
                  )}
                  {(selectedPlan.status === 'DRAFT' || selectedPlan.status === 'APPROVED') && (
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange(selectedPlan, 'CANCELLED')} disabled={updateStatus.isPending}>
                      {updateStatus.isPending ? '处理中…' : '取消计划'}
                    </Button>
                  )}
                </div>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>
                  关闭
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <CreateTreatmentPlanDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        presetPatientId={presetPatientId}
        presetVisitId={presetVisitId}
        onCreate={createPlan.mutateAsync}
        isPending={createPlan.isPending}
      />
    </div>
  );
}
