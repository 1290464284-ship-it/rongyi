import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Check, ChevronRight, ListTodo, X, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
  ITEM_STATUS_LABEL,
  ITEM_STATUS_COLOR,
  type TreatmentPlan,
  type PlanStatus,
  type PlanItemStatus,
} from '@/lib/treatment-plans';
import { usePatients } from '@/lib/patients';
import { useStaff } from '@/lib/staff';
import { useAuthStore } from '@/lib/auth-store';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

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
              <option value="APPROVED">已审批</option>
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

interface EditablePlanItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: number[];
}

function CreateTreatmentPlanDialog({
  open,
  onClose,
  presetPatientId,
  presetVisitId,
  onCreate,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  presetPatientId?: string;
  presetVisitId?: string;
  onCreate: (data: any) => Promise<any>;
  isPending?: boolean;
}) {
  const user = useAuthStore(s => s.user);
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [patientName, setPatientName] = useState('');
  const [doctorId, setDoctorId] = useState(user?.role === 'DOCTOR' ? user.id : '');
  const [planName, setPlanName] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<EditablePlanItem[]>([
    { id: '1', code: '', name: '', category: '修复', price: 0, quantity: 1, teethNumbers: [] },
  ]);
  const [openSelector, setOpenSelector] = useState(false);

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
    setOpenSelector(false);
  };

  const totalFee = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  function addItem() {
    setItems([
      ...items,
      { id: Date.now().toString(), code: '', name: '', category: '修复', price: 0, quantity: 1, teethNumbers: [] },
    ]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter(i => i.id !== id));
  }

  function updateItem(id: string, field: keyof EditablePlanItem, value: any) {
    setItems(items.map(i => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function handleSubmit() {
    if (!patientId || !doctorId || !planName || items.some(i => !i.name)) return;
    await onCreate({
      patientId,
      doctorId,
      visitId: presetVisitId || undefined,
      name: planName,
      remark: remark || undefined,
      items: items.map(({ id: _id, ...rest }) => rest),
    });
    onClose();
    setPlanName('');
    setRemark('');
    setItems([{ id: '1', code: '', name: '', category: '修复', price: 0, quantity: 1, teethNumbers: [] }]);
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>新建治疗计划</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>患者 *</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <User className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-doctor">主治医生 *</Label>
              <Select id="plan-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="">请选择医生</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">计划名称 *</Label>
              <Input
                id="plan-name"
                placeholder="如：根管治疗计划"
                value={planName}
                onChange={e => setPlanName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>治疗项目</Label>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> 添加项目
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 p-2 border border-border rounded-md items-center">
                  <span className="text-sm text-muted-foreground col-span-1">{idx + 1}</span>
                  <Input
                    placeholder="项目编码"
                    value={item.code}
                    onChange={e => updateItem(item.id, 'code', e.target.value)}
                    className="col-span-2"
                  />
                  <Input
                    placeholder="项目名称"
                    value={item.name}
                    onChange={e => updateItem(item.id, 'name', e.target.value)}
                    className="col-span-3"
                  />
                  <Select
                    value={item.category}
                    onChange={e => updateItem(item.id, 'category', e.target.value)}
                    className="col-span-2"
                  >
                    <option value="修复">修复</option>
                    <option value="外科">外科</option>
                    <option value="牙体牙髓">牙体牙髓</option>
                    <option value="牙周">牙周</option>
                    <option value="正畸">正畸</option>
                    <option value="儿童口腔">儿童口腔</option>
                    <option value="种植">种植</option>
                    <option value="检查">检查</option>
                    <option value="其他">其他</option>
                  </Select>
                  <Input
                    type="number"
                    placeholder="单价"
                    value={item.price || ''}
                    onChange={e => updateItem(item.id, 'price', Number(e.target.value))}
                    className="col-span-2"
                  />
                  <Input
                    type="number"
                    placeholder="数量"
                    value={item.quantity}
                    onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                    className="col-span-1"
                  />
                  <div className="col-span-1 flex items-center justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-sm text-muted-foreground">
              共 {items.length} 项
            </div>
            <div className="text-lg font-semibold">
              预计总费用：<span className="text-primary">¥{totalFee.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-remark">备注</Label>
            <Textarea
              id="plan-remark"
              placeholder="计划备注（可选）"
              value={remark}
              onChange={e => setRemark(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId || !doctorId || !planName || items.some(i => !i.name) || isPending}>
              <Check className="w-4 h-4 mr-2" />
              {isPending ? '创建中…' : '创建计划'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <PatientSelector
      open={openSelector}
      onClose={() => setOpenSelector(false)}
      onSelect={handleSelectPatient}
      title="选择患者"
    />
    </>
  );
}

function AggregateView({
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

function DetailView({ plan }: { plan: TreatmentPlan }) {
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
