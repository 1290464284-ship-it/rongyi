import { useState, useMemo } from 'react';
import { Plus, Edit, Trash2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useProcessingOrders,
  useCreateProcessingOrder,
  useUpdateProcessingOrder,
  useDeleteProcessingOrder,
  useUpdateProcessingOrderStatus,
  useProcessingFactories,
  PROCESSING_ORDER_STATUS_LABEL,
  PROCESSING_ORDER_STATUS_COLOR,
  type ProcessingOrder,
  type ProcessingOrderStatus,
} from '@/lib/api/inventory/processing-orders';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';
import { OrderDialog } from './OrderDialog';

export function OrdersTab() {
  const [statusFilter, setStatusFilter] = useState<ProcessingOrderStatus | ''>('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [orderOpen, setOrderOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ProcessingOrder | null>(null);
  const [statusOrder, setStatusOrder] = useState<ProcessingOrder | null>(null);
  const [newStatus, setNewStatus] = useState<ProcessingOrderStatus>('PENDING');

  const { data: ordersData, isLoading: ordersLoading } = useProcessingOrders({
    status: statusFilter || undefined,
    factoryId: factoryFilter || undefined,
    page,
    pageSize,
  });
  const { data: factoriesData } = useProcessingFactories();
  const factories = factoriesData?.items ?? [];

  const createOrder = useCreateProcessingOrder();
  const updateOrder = useUpdateProcessingOrder();
  const deleteOrder = useDeleteProcessingOrder();
  const updateStatus = useUpdateProcessingOrderStatus();

  const orders = ordersData?.items ?? [];
  const total = ordersData?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredOrders = useMemo(() => {
    if (!keyword) return orders;
    const kw = keyword.toLowerCase();
    return orders.filter(
      o =>
        o.patient?.name?.toLowerCase().includes(kw) ||
        o.patientName.toLowerCase().includes(kw) ||
        o.factoryName.toLowerCase().includes(kw)
    );
  }, [orders, keyword]);

  const handleCreateOrder = () => {
    setEditingOrder(null);
    setOrderOpen(true);
  };

  const handleEditOrder = (order: ProcessingOrder) => {
    setEditingOrder(order);
    setOrderOpen(true);
  };

  const handleDeleteOrder = async (id: string) => {
    if (!confirm('确定删除此加工单？')) return;
    await deleteOrder.mutateAsync(id);
    toast.success('删除成功');
  };

  const handleOpenStatus = (order: ProcessingOrder) => {
    setStatusOrder(order);
    setNewStatus(order.status);
    setStatusOpen(true);
  };

  const handleUpdateStatus = async () => {
    if (!statusOrder) return;
    await updateStatus.mutateAsync({ id: statusOrder.id, status: newStatus });
    toast.success('状态更新成功');
    setStatusOpen(false);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex gap-2 items-center">
            <div className="flex gap-2">
              <Select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value as ProcessingOrderStatus | ''); setPage(1); }}
              >
                <option value="">全部状态</option>
                {Object.entries(PROCESSING_ORDER_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
              <Select
                value={factoryFilter}
                onChange={e => { setFactoryFilter(e.target.value); setPage(1); }}
              >
                <option value="">全部加工厂</option>
                {factories.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
              <Input
                placeholder="搜索单号/患者/加工厂"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                className="w-64"
              />
            </div>
          </div>
          <Button onClick={handleCreateOrder}>
            <Plus className="w-4 h-4 mr-2" />
            新建加工单
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>单号</TableHead>
                <TableHead>患者</TableHead>
                <TableHead>加工厂</TableHead>
                <TableHead>产品明细</TableHead>
                <TableHead>费用</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map(order => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-sm">{order.patientCode}</TableCell>
                  <TableCell>{order.patient?.name || order.patientName || '-'}</TableCell>
                  <TableCell>{order.factoryName || '-'}</TableCell>
                  <TableCell>
                    {order.items?.slice(0, 2).map((item, i) => (
                      <div key={i} className="text-sm">
                        {item.productName} x{item.quantity}
                      </div>
                    ))}
                    {order.items?.length > 2 && (
                      <div className="text-xs text-muted-foreground">等{order.items.length}项</div>
                    )}
                  </TableCell>
                  <TableCell>¥{order.totalAmount}</TableCell>
                  <TableCell>
                    <Badge className={PROCESSING_ORDER_STATUS_COLOR[order.status]}>
                      {PROCESSING_ORDER_STATUS_LABEL[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(order.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEditOrder(order)}>
                        <Edit className="w-3 h-3 mr-1" />编辑
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenStatus(order)}>
                        <ArrowRight className="w-3 h-3 mr-1" />状态
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteOrder(order.id)}>
                        <Trash2 className="w-3 h-3 mr-1" />删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {ordersLoading && (
                <TableLoading colSpan={8} />
              )}
              {filteredOrders.length === 0 && !ordersLoading && (
                <EmptyState colSpan={8} text="暂无数据" />
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-4">
              <span className="text-sm text-muted-foreground">共 {total} 条</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  上一页
                </Button>
                <span className="text-sm px-2 py-1">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <OrderDialog
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        editing={editingOrder}
        factories={factories}
        onSubmit={async (data) => {
          if (editingOrder) {
            await updateOrder.mutateAsync({ id: editingOrder.id, data });
            toast.success('更新成功');
          } else {
            await createOrder.mutateAsync(data);
            toast.success('创建成功');
          }
          setOrderOpen(false);
        }}
      />

      <Dialog open={statusOpen} onClose={() => setStatusOpen(false)}>
        <DialogHeader>
          <DialogTitle>更新状态</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="po-status">状态</Label>
              <Select id="po-status" value={newStatus} onChange={e => setNewStatus(e.target.value as ProcessingOrderStatus)}>
                {Object.entries(PROCESSING_ORDER_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusOpen(false)}>取消</Button>
              <Button onClick={handleUpdateStatus}>确认</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
