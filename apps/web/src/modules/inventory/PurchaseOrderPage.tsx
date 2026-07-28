import { useMemo, useState } from 'react';
import { Plus, Trash2, Eye, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useIsBoss } from '@/components/ui/permission';
import {
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useReceivePurchaseOrder,
  useCancelPurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/lib/api/inventory/purchase-orders';
import { useSuppliers } from '@/lib/api/inventory/suppliers';
import { useInventoryItems } from '@/lib/api/inventory/inventory';
import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';
import { formatDateTime } from '@/lib/utils';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  RECEIVED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
};

interface OrderLine {
  itemId: string;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: OrderLine = { itemId: '', name: '', spec: '', quantity: '1', unitPrice: '0' };

export default function PurchaseOrderPage() {
  const isBoss = useIsBoss();
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = usePurchaseOrders({
    status: status === 'ALL' ? undefined : (status as PurchaseOrderStatus),
    page,
    pageSize: PAGE_SIZE,
  });

  const createMut = useCreatePurchaseOrder();
  const receiveMut = useReceivePurchaseOrder();
  const cancelMut = useCancelPurchaseOrder();

  const { data: suppliersData } = useSuppliers('', 1, DROPDOWN_MAX_PAGE_SIZE);
  const suppliers = suppliersData?.items ?? [];

  const { data: invData } = useInventoryItems({ pageSize: DROPDOWN_MAX_PAGE_SIZE });
  const invItems = invData?.items ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ supplierId: '', remark: '' });
  const [lines, setLines] = useState<OrderLine[]>([{ ...EMPTY_LINE }]);

  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [detailTarget, setDetailTarget] = useState<PurchaseOrder | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totalAmount = useMemo(() => {
    return lines.reduce((sum, l) => {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [lines]);

  const openCreate = () => {
    setForm({ supplierId: '', remark: '' });
    setLines([{ ...EMPTY_LINE }]);
    setCreateOpen(true);
  };

  const handleAddLine = () => {
    setLines([...lines, { ...EMPTY_LINE }]);
  };

  const handleRemoveLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, patch: Partial<OrderLine>) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleLineItemSelect = (idx: number, itemId: string) => {
    if (!itemId) {
      handleLineChange(idx, { itemId: '', name: '', spec: '', unitPrice: '0' });
      return;
    }
    const item = invItems.find((i) => i.id === itemId);
    if (item) {
      handleLineChange(idx, {
        itemId,
        name: item.name,
        spec: item.spec ?? '',
        unitPrice: String(item.price ?? 0),
      });
    }
  };

  const handleCreate = () => {
    if (!form.supplierId) {
      toast.error('请选择供应商');
      return;
    }
    const validLines = lines.filter((l) => l.name.trim() && (parseFloat(l.quantity) || 0) > 0);
    if (validLines.length === 0) {
      toast.error('请至少添加一条有效明细');
      return;
    }
    const payload = {
      supplierId: form.supplierId,
      remark: form.remark.trim() || undefined,
      items: validLines.map((l) => ({
        itemId: l.itemId || '',
        name: l.name.trim(),
        spec: l.spec.trim() || '',
        quantity: parseFloat(l.quantity),
        unitPrice: (parseFloat(l.unitPrice) || 0).toString(),
      })),
    };
    createMut.mutate(payload, {
      onSuccess: () => {
        toast.success('采购订单已创建');
        setCreateOpen(false);
        setPage(1);
      },
    });
  };

  const handleReceive = () => {
    if (!receiveTarget) return;
    receiveMut.mutate(receiveTarget.id, {
      onSuccess: () => {
        toast.success('已确认收货');
        setReceiveTarget(null);
      },
    });
  };

  const handleCancel = () => {
    if (!cancelTarget) return;
    cancelMut.mutate(cancelTarget.id, {
      onSuccess: () => {
        toast.success('订单已取消');
        setCancelTarget(null);
      },
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">采购订单</h1>
          <p className="text-sm text-muted-foreground mt-1">管理供应商采购订单及收货</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />新建订单
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="po-filter-status" className="text-muted-foreground">状态</Label>
            <Select
              id="po-filter-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-32"
            >
              <option value="ALL">全部</option>
              <option value="PENDING">待收货</option>
              <option value="RECEIVED">已收货</option>
              <option value="CANCELLED">已取消</option>
            </Select>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">共 {total} 个订单</div>
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">订单号</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead className="w-28 text-right">总金额</TableHead>
                <TableHead className="w-24 text-center">状态</TableHead>
                <TableHead className="w-24">操作员</TableHead>
                <TableHead className="w-40">创建时间</TableHead>
                <TableHead className="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={7}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={7} />
              ) : items.length === 0 ? (
                <EmptyState colSpan={7} text="暂无采购订单" />
              ) : (
                items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Badge className="bg-primary/10 text-primary font-mono">{o.number}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{o.supplierName ?? '-'}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      ¥{Number(o.totalAmount).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={STATUS_CLASS[o.status]}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{o.operatorName ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setDetailTarget(o)} title="详情" aria-label="查看">
                          <Eye className="h-4 w-4" />
                        </Button>
                        {o.status === 'PENDING' && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setReceiveTarget(o)}
                              title="收货"
                              className="text-success hover:text-success"
                              aria-label="收货"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            {isBoss && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setCancelTarget(o)}
                                title="取消"
                                className="text-destructive hover:text-destructive"
                                aria-label="取消"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 新建订单弹窗 */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建采购订单</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="po-supplier">供应商 *</Label>
              <Select
                id="po-supplier"
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              >
                <option value="">请选择</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-remark">备注</Label>
              <Input
                id="po-remark"
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
                placeholder="可选"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>明细</Label>
              <Button variant="outline" size="sm" onClick={handleAddLine}>
                <Plus className="h-4 w-4 mr-1" />添加
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>物品</TableHead>
                    <TableHead className="w-24 text-right">数量</TableHead>
                    <TableHead className="w-28 text-right">单价</TableHead>
                    <TableHead className="w-28 text-right">小计</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="space-y-1">
                          <Select
                            value={l.itemId}
                            onChange={(e) => handleLineItemSelect(idx, e.target.value)}
                            className="w-full"
                          >
                            <option value="">手动输入</option>
                            {invItems.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.code})
                              </option>
                            ))}
                          </Select>
                          <Input
                            value={l.name}
                            onChange={(e) => handleLineChange(idx, { name: e.target.value })}
                            placeholder="物品名称"
                          />
                          <Input
                            value={l.spec}
                            onChange={(e) => handleLineChange(idx, { spec: e.target.value })}
                            placeholder="规格（可选）"
                            className="text-xs"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="align-top pt-2">
                        <Input
                          type="number"
                          min="1"
                          value={l.quantity}
                          onChange={(e) => handleLineChange(idx, { quantity: e.target.value })}
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell className="align-top pt-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitPrice}
                          onChange={(e) => handleLineChange(idx, { unitPrice: e.target.value })}
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right align-top font-medium pt-3">
                        ¥{((parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0)).toFixed(2)}
                      </TableCell>
                      <TableCell className="align-top pt-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveLine(idx)}
                          disabled={lines.length <= 1}
                          className="text-destructive hover:text-destructive"
                          title="删除"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <div className="text-sm">
                合计：<span className="text-lg font-semibold text-primary">¥{totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <LoadingButton onClick={handleCreate} loading={createMut.isPending} loadingText="创建中…">
              创建订单
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 收货确认弹窗 */}
      <Dialog open={!!receiveTarget} onClose={() => setReceiveTarget(null)}>
        <DialogHeader>
          <DialogTitle>确认收货</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-sm">
            确认收到采购订单 <span className="font-medium font-mono">{receiveTarget?.number}</span>
            （{receiveTarget?.supplierName}）的货物吗？收货后将自动入库。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>
              取消
            </Button>
            <LoadingButton
              onClick={handleReceive}
              loading={receiveMut.isPending}
              loadingText="处理中…"
              className="bg-success hover:bg-success/90 text-white"
            >
              确认收货
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 取消订单弹窗 */}
      <Dialog open={!!cancelTarget} onClose={() => setCancelTarget(null)}>
        <DialogHeader>
          <DialogTitle>取消订单</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-sm">
            确定要取消采购订单 <span className="font-medium font-mono">{cancelTarget?.number}</span>
            （{cancelTarget?.supplierName}）吗？此操作不可撤销。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              取消
            </Button>
            <LoadingButton
              variant="destructive"
              onClick={handleCancel}
              loading={cancelMut.isPending}
              loadingText="处理中…"
            >
              确认取消
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 订单详情弹窗 */}
      <Dialog open={!!detailTarget} onClose={() => setDetailTarget(null)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>订单详情</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          {detailTarget && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">订单号</span>
                  <span className="font-mono font-medium">{detailTarget.number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <Badge className={STATUS_CLASS[detailTarget.status]}>
                    {STATUS_LABEL[detailTarget.status] ?? detailTarget.status}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">供应商</span>
                  <span className="font-medium">{detailTarget.supplierName ?? '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">操作员</span>
                  <span>{detailTarget.operatorName ?? '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">创建时间</span>
                  <span>{formatDateTime(detailTarget.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">总金额</span>
                  <span className="font-semibold text-primary">
                    ¥{Number(detailTarget.totalAmount).toFixed(2)}
                  </span>
                </div>
              </div>
              {detailTarget.remark && (
                <div className="text-sm">
                  <span className="text-muted-foreground">备注：</span>
                  {detailTarget.remark}
                </div>
              )}
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>规格</TableHead>
                      <TableHead className="text-right">数量</TableHead>
                      <TableHead className="text-right">单价</TableHead>
                      <TableHead className="text-right">小计</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detailTarget.items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                          暂无明细
                        </TableCell>
                      </TableRow>
                    ) : (
                      (detailTarget.items ?? []).map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="font-medium">{it.name}</TableCell>
                          <TableCell className="text-muted-foreground">{it.spec ?? '-'}</TableCell>
                          <TableCell className="text-right">{it.quantity}</TableCell>
                          <TableCell className="text-right">¥{Number(it.unitPrice).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">
                            ¥{Number(it.subtotal).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
