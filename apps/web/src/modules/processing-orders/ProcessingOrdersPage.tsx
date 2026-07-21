import { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Search,
  Factory,
  Package,
  Edit,
  Trash2,
  Check,
  X,
  ArrowRight,
  DollarSign,
  Clock,
} from 'lucide-react';
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
  useCreateProcessingFactory,
  useUpdateProcessingFactory,
  useDeleteProcessingFactory,
  useProcessingProducts,
  useCreateProcessingProduct,
  useUpdateProcessingProduct,
  useDeleteProcessingProduct,
  useProcessingStats,
  PROCESSING_ORDER_STATUS_LABEL,
  PROCESSING_ORDER_STATUS_COLOR,
  type ProcessingOrder,
  type ProcessingOrderStatus,
  type ProcessingFactory,
  type ProcessingProduct,
  type ProcessingOrderItem,
} from '@/lib/processing-orders';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';

type Tab = 'orders' | 'factories' | 'products' | 'stats';

interface OrderItemForm {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  teethNumbers: number[];
}

export default function ProcessingOrdersPage() {
  const [tab, setTab] = useState<Tab>('orders');
  const [statusFilter, setStatusFilter] = useState<ProcessingOrderStatus | ''>('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [orderOpen, setOrderOpen] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const [editingOrder, setEditingOrder] = useState<ProcessingOrder | null>(null);
  const [editingFactory, setEditingFactory] = useState<ProcessingFactory | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProcessingProduct | null>(null);
  const [statusOrder, setStatusOrder] = useState<ProcessingOrder | null>(null);
  const [newStatus, setNewStatus] = useState<ProcessingOrderStatus>('PENDING');

  const [productFactoryId, setProductFactoryId] = useState('');

  const { data: ordersData, isLoading: ordersLoading } = useProcessingOrders({
    status: statusFilter || undefined,
    factoryId: factoryFilter || undefined,
    page,
    pageSize,
  });

  const { data: factoriesData } = useProcessingFactories();
  const { data: productsData } = useProcessingProducts({ factoryId: productFactoryId || undefined });
  const factories = factoriesData?.items ?? [];
  const products = productsData?.items ?? [];
  const { data: stats } = useProcessingStats();

  const createOrder = useCreateProcessingOrder();
  const updateOrder = useUpdateProcessingOrder();
  const deleteOrder = useDeleteProcessingOrder();
  const updateStatus = useUpdateProcessingOrderStatus();
  const createFactory = useCreateProcessingFactory();
  const updateFactory = useUpdateProcessingFactory();
  const deleteFactory = useDeleteProcessingFactory();
  const createProduct = useCreateProcessingProduct();
  const updateProduct = useUpdateProcessingProduct();
  const deleteProduct = useDeleteProcessingProduct();

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

  const handleCreateFactory = () => {
    setEditingFactory(null);
    setFactoryOpen(true);
  };

  const handleEditFactory = (f: ProcessingFactory) => {
    setEditingFactory(f);
    setFactoryOpen(true);
  };

  const handleDeleteFactory = async (id: string) => {
    if (!confirm('确定删除此加工厂？')) return;
    await deleteFactory.mutateAsync(id);
    toast.success('删除成功');
  };

  const handleCreateProduct = () => {
    if (!productFactoryId) {
      toast.error('请先选择加工厂');
      return;
    }
    setEditingProduct(null);
    setProductOpen(true);
  };

  const handleEditProduct = (p: ProcessingProduct) => {
    setEditingProduct(p);
    setProductOpen(true);
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('确定删除此产品？')) return;
    await deleteProduct.mutateAsync(id);
    toast.success('删除成功');
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">加工单管理</h1>
      </div>

      <div className="flex gap-2 border-b">
        {[
          { key: 'orders', label: '加工单', icon: Package },
          { key: 'factories', label: '加工厂', icon: Factory },
          { key: 'products', label: '加工产品', icon: Package },
          { key: 'stats', label: '统计', icon: DollarSign },
        ].map(t => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'default' : 'ghost'}
            onClick={() => setTab(t.key as Tab)}
            className="gap-2"
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'orders' && (
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
      )}

      {tab === 'factories' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <h3 className="font-semibold">加工厂管理</h3>
            <Button onClick={handleCreateFactory}>
              <Plus className="w-4 h-4 mr-2" />
              新增加工厂
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>电话</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factories.map(f => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{f.contactName || '-'}</TableCell>
                    <TableCell>{f.phone || '-'}</TableCell>
                    <TableCell>{f.address || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{f.remark || '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(f.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleEditFactory(f)}>
                          <Edit className="w-3 h-3 mr-1" />编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteFactory(f.id)}>
                          <Trash2 className="w-3 h-3 mr-1" />删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {factoriesData && factories.length === 0 && (
                  <EmptyState colSpan={7} text="暂无加工厂" />
                )}
                {!factoriesData && (
                  <TableLoading colSpan={7} />
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 'products' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex gap-2 items-center">
            <Select value={productFactoryId} onChange={e => setProductFactoryId(e.target.value)}>
              <option value="">选择加工厂</option>
              {factories.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </div>
          <Button onClick={handleCreateProduct}>
            <Plus className="w-4 h-4 mr-2" />
            新增产品
          </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>产品名称</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>价格</TableHead>
                  <TableHead>单位</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.code || '-'}</TableCell>
                    <TableCell>¥{p.price}</TableCell>
                    <TableCell>{p.unit || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.remark || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleEditProduct(p)}>
                          <Edit className="w-3 h-3 mr-1" />编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteProduct(p.id)}>
                          <Trash2 className="w-3 h-3 mr-1" />删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {productsData && products.length === 0 && (
                  <EmptyState colSpan={6} text={productFactoryId ? '暂无产品' : '请先选择加工厂'} />
                )}
                {!productsData && productFactoryId && (
                  <TableLoading colSpan={6} />
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 'stats' && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">总单数</div>
              <div className="text-2xl font-bold mt-1">{stats?.total ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">进行中</div>
              <div className="text-2xl font-bold mt-1 text-warning">{stats?.inProgress ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">待交付</div>
              <div className="text-2xl font-bold mt-1 text-info">{stats?.ready ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">已交付</div>
              <div className="text-2xl font-bold mt-1 text-success">{stats?.delivered ?? 0}</div>
            </CardContent>
          </Card>
        </div>
      )}

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

      <FactoryDialog
        open={factoryOpen}
        onClose={() => setFactoryOpen(false)}
        editing={editingFactory}
        onSubmit={async (data) => {
          if (editingFactory) {
            await updateFactory.mutateAsync({ id: editingFactory.id, data });
            toast.success('更新成功');
          } else {
            await createFactory.mutateAsync(data);
            toast.success('创建成功');
          }
          setFactoryOpen(false);
        }}
      />

      <ProductDialog
        open={productOpen}
        onClose={() => setProductOpen(false)}
        editing={editingProduct}
        factoryId={productFactoryId}
        onSubmit={async (data) => {
          if (editingProduct) {
            await updateProduct.mutateAsync({ id: editingProduct.id, data });
            toast.success('更新成功');
          } else {
            await createProduct.mutateAsync(data);
            toast.success('创建成功');
          }
          setProductOpen(false);
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
    </div>
  );
}

function OrderDialog({
  open,
  onClose,
  editing,
  factories,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProcessingOrder | null;
  factories: ProcessingFactory[];
  onSubmit: (data: any) => Promise<void>;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<OrderItemForm[]>([]);

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  const { data: factoryProductsData } = useProcessingProducts({ factoryId: factoryId || undefined });
  const factoryProducts = factoryProductsData?.items ?? [];

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setPatientId(editing.patientId);
      setPatientName(editing.patient?.name || '');
      setFactoryId(editing.factoryId);
      setDoctorId('');
      setRemark(editing.remark || '');
      setItems(
        editing.items?.map(item => ({
          id: item.id || Math.random().toString(),
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          teethNumbers: item.teethNumbers || [],
        })) || []
      );
    } else {
      setPatientId('');
      setPatientName('');
      setFactoryId('');
      setDoctorId('');
      setRemark('');
      setItems([]);
    }
  }, [editing, open]);

  const addItem = () => {
    if (factoryProducts.length > 0) {
      const first = factoryProducts[0];
      setItems([...items, {
        id: Math.random().toString(),
        productId: first.id,
        productName: first.name,
        quantity: 1,
        unitPrice: String(first.price),
        teethNumbers: [],
      }]);
    }
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    if (field === 'productId') {
      const product = factoryProducts.find(p => p.id === value);
      if (product) {
        newItems[idx].productName = product.name;
        newItems[idx].unitPrice = String(product.price);
      }
    }
    setItems(newItems);
  };

  const totalAmount = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);

  const handleSubmit = async () => {
    if (!patientId) { toast.error('请选择患者'); return; }
    if (!factoryId) { toast.error('请选择加工厂'); return; }
    const data = {
      patientId,
      factoryId,
      doctorId: doctorId || undefined,
      remark,
      items: items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: String(item.unitPrice),
        teethNumbers: item.teethNumbers,
      })),
    };
    await onSubmit(data);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? '编辑加工单' : '新建加工单'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>患者</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <Search className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-factory">加工厂</Label>
              <Select id="po-factory" value={factoryId} onChange={e => setFactoryId(e.target.value)}>
                <option value="">请选择</option>
                {factories.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>加工项目</Label>
              <Button variant="outline" size="sm" onClick={addItem} disabled={!factoryId}>
                <Plus className="w-3 h-3 mr-1" />添加
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-end border p-2 rounded">
                  <div className="flex-1">
                    <Select
                      value={item.productId}
                      onChange={e => updateItem(idx, 'productId', e.target.value)}
                    >
                      {factoryProducts.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {items.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-4">
                  暂无项目，点击上方添加
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="po-remark">备注</Label>
            <Input id="po-remark" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-between items-center pt-2 border-t">
            <span className="text-sm text-muted-foreground">合计</span>
            <span className="text-xl font-bold">¥{totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '保存' : '创建'}</Button>
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

function FactoryDialog({
  open,
  onClose,
  editing,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProcessingFactory | null;
  onSubmit: (data: Partial<ProcessingFactory>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [remark, setRemark] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setContact(editing.contactName || '');
      setPhone(editing.phone || '');
      setAddress(editing.address || '');
      setRemark(editing.remark || '');
    } else {
      setName('');
      setContact('');
      setPhone('');
      setAddress('');
      setRemark('');
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    if (!name) { toast.error('请输入名称'); return; }
    await onSubmit({ name: name || '', contactName: contact || '', phone: phone || '', address: address || '', remark: remark || '' });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{editing ? '编辑加工厂' : '新增加工厂'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="factory-name">名称 *</Label>
            <Input id="factory-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="factory-contact">联系人</Label>
              <Input id="factory-contact" value={contact} onChange={e => setContact(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="factory-phone">电话</Label>
              <Input id="factory-phone" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="factory-address">地址</Label>
            <Input id="factory-address" value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="factory-remark">备注</Label>
            <Input id="factory-remark" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '保存' : '创建'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({
  open,
  onClose,
  editing,
  factoryId,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProcessingProduct | null;
  factoryId: string;
  onSubmit: (data: Partial<ProcessingProduct>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [remark, setRemark] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCategory(editing.code || '');
      setPrice(String(editing.price));
      setUnit(editing.unit || '');
      setRemark(editing.remark || '');
    } else {
      setName('');
      setCategory('');
      setPrice('');
      setUnit('');
      setRemark('');
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    if (!name) { toast.error('请输入名称'); return; }
    if (!price) { toast.error('请输入价格'); return; }
    await onSubmit({
      factoryId: editing?.factoryId || factoryId,
      name,
      code: category,
      price: parseFloat(price) || 0,
      unit,
      remark,
    });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{editing ? '编辑产品' : '新增产品'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-name">产品名称 *</Label>
            <Input id="product-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product-category">分类</Label>
              <Input id="product-category" value={category} onChange={e => setCategory(e.target.value)} placeholder="如：烤瓷/正畸" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-price">价格 *</Label>
              <Input id="product-price" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product-unit">单位</Label>
              <Input id="product-unit" value={unit} onChange={e => setUnit(e.target.value)} placeholder="个/颗/副" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-remark">备注</Label>
            <Input id="product-remark" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '保存' : '创建'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
