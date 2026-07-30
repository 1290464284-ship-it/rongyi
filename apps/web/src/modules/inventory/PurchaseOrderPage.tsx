import { useState } from 'react';
import { Plus, Eye, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
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
import { CreateOrderDialog, ReceiveDialog, CancelOrderDialog, OrderDetailDialog, STATUS_LABEL, STATUS_CLASS } from './components/PurchaseOrderDialogs';

const PAGE_SIZE = 20;

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
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [detailTarget, setDetailTarget] = useState<PurchaseOrder | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openCreate = () => setCreateOpen(true);

  const handleCreate = (payload: Parameters<typeof createMut.mutate>[0]) => {
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

      <CreateOrderDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        suppliers={suppliers}
        invItems={invItems}
        onCreate={handleCreate}
        isPending={createMut.isPending}
      />

      <ReceiveDialog
        target={receiveTarget}
        onClose={() => setReceiveTarget(null)}
        onReceive={handleReceive}
        isPending={receiveMut.isPending}
      />

      <CancelOrderDialog
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancel={handleCancel}
        isPending={cancelMut.isPending}
      />

      <OrderDetailDialog
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
    </div>
  );
}
