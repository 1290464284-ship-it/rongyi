import { useMemo, useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Search, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useInventoryItems,
  useLowStockItems,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useInventoryTransactions,
  useStockAction,
  type InventoryItem,
} from '@/lib/inventory';
import { useSuppliers } from '@/lib/suppliers';
import { formatDate, formatDateTime, debounce } from '@/lib/utils';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const TX_TYPE_LABEL: Record<string, string> = {
  IN: '入库',
  OUT: '出库',
  ADJUST: '调整',
};

const TX_TYPE_CLASS: Record<string, string> = {
  IN: 'bg-success/10 text-success',
  OUT: 'bg-destructive/10 text-destructive',
  ADJUST: 'bg-primary/10 text-primary',
};

interface FormState {
  code: string;
  name: string;
  spec: string;
  category: string;
  unit: string;
  stock: string;
  minStock: string;
  price: string;
  supplierId: string;
  expireDate: string;
  location: string;
  remark: string;
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  spec: '',
  category: '',
  unit: '',
  stock: '0',
  minStock: '0',
  price: '0',
  supplierId: '',
  expireDate: '',
  location: '',
  remark: '',
};

type TabKey = 'list' | 'transactions' | 'lowstock';

export default function InventoryPage() {
  const [tab, setTab] = useState<TabKey>('list');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'list', label: '库存列表' },
    { key: 'transactions', label: '出入库记录' },
    { key: 'lowstock', label: '低库存预警' },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">库存管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理库存物资及出入库记录</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list' && <InventoryListTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'lowstock' && <LowStockTab />}
    </div>
  );
}

function InventoryListTab() {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [category, setCategory] = useState('ALL');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useInventoryItems({
    keyword: debouncedKeyword,
    category: category === 'ALL' ? undefined : category,
    page,
    pageSize: PAGE_SIZE,
  });

  useEffect(() => {
    const debounceFn = debounce(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    debounceFn();
    return () => debounceFn.cancel();
  }, [keyword]);

  const createMut = useCreateInventoryItem();
  const updateMut = useUpdateInventoryItem();
  const deleteMut = useDeleteInventoryItem();
  const stockMut = useStockAction();

  const { data: suppliersData } = useSuppliers('', 1, 200);
  const suppliers = suppliersData?.items ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [stockTarget, setStockTarget] = useState<InventoryItem | null>(null);
  const [stockForm, setStockForm] = useState({
    type: 'IN',
    quantity: '',
    unitPrice: '',
    remark: '',
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category || '未分类'));
    return Array.from(set);
  }, [items]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      spec: item.spec ?? '',
      category: item.category,
      unit: item.unit,
      stock: String(item.stock ?? 0),
      minStock: String(item.minStock ?? 0),
      price: String(item.price ?? 0),
      supplierId: item.supplierId ?? '',
      expireDate: item.expireDate ? item.expireDate.slice(0, 10) : '',
      location: item.location ?? '',
      remark: item.remark ?? '',
    });
    setDialogOpen(true);
  };

  const openStock = (item: InventoryItem) => {
    setStockTarget(item);
    setStockForm({
      type: 'IN',
      quantity: '',
      unitPrice: String(item.price ?? 0),
      remark: '',
    });
  };

  const handleSubmit = () => {
    if (!form.code.trim() || !form.name.trim() || !form.category.trim() || !form.unit.trim()) {
      toast.error('请填写编码、名称、分类和单位');
      return;
    }
    const minStock = parseInt(form.minStock, 10) || 0;
    const price = parseFloat(form.price) || 0;
    const base = {
      code: form.code.trim(),
      name: form.name.trim(),
      spec: form.spec.trim() || undefined,
      category: form.category.trim(),
      unit: form.unit.trim(),
      minStock,
      price,
      supplierId: form.supplierId || undefined,
      expireDate: form.expireDate || undefined,
      location: form.location.trim() || undefined,
      remark: form.remark.trim() || undefined,
    };
    if (editing) {
      updateMut.mutate(
        { id: editing.id, data: base },
        {
          onSuccess: () => {
            toast.success('已更新');
            setDialogOpen(false);
          },
        },
      );
    } else {
      const stock = parseInt(form.stock, 10) || 0;
      createMut.mutate(
        { ...base, stock },
        {
          onSuccess: () => {
            toast.success('已新增');
            setDialogOpen(false);
          },
        },
      );
    }
  };

  const handleStock = () => {
    if (!stockTarget) return;
    const quantity = parseInt(stockForm.quantity, 10);
    if (isNaN(quantity) || quantity <= 0) {
      toast.error('请输入正确的数量');
      return;
    }
    stockMut.mutate(
      {
        itemId: stockTarget.id,
        type: stockForm.type as 'IN' | 'OUT' | 'ADJUST',
        quantity,
        unitPrice: stockForm.unitPrice.trim() || undefined,
        remark: stockForm.remark.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('操作成功');
          setStockTarget(null);
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('已删除');
        setDeleteTarget(null);
      },
    });
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="inv-filter-category" className="text-muted-foreground">分类</Label>
          <Select
            id="inv-filter-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="w-40"
          >
            <option value="ALL">全部分类</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="名称 / 编码"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">共 {total} 项</span>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />新增物品
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-28">规格</TableHead>
              <TableHead className="w-24">分类</TableHead>
              <TableHead className="w-20 text-right">库存</TableHead>
              <TableHead className="w-16">单位</TableHead>
              <TableHead className="w-24 text-right">最低库存</TableHead>
              <TableHead className="w-24 text-right">单价</TableHead>
              <TableHead className="w-32">供应商</TableHead>
              <TableHead className="w-28">有效期</TableHead>
              <TableHead className="w-24">位置</TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={12} />
            ) : items.length === 0 ? (
              <EmptyState colSpan={12} text="暂无库存物品" />
            ) : (
              items.map((item) => {
                const low = item.stock <= item.minStock;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge className="bg-primary/10 text-primary font-mono">{item.code}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.spec ?? '-'}</TableCell>
                    <TableCell>
                      <Badge className="bg-muted text-muted-foreground">{item.category || '未分类'}</Badge>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${low ? 'text-destructive' : ''}`}>
                      {item.stock}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{item.minStock}</TableCell>
                    <TableCell className="text-right">¥{Number(item.price).toFixed(2)}</TableCell>
                    <TableCell className="text-muted-foreground">{item.supplierName ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.expireDate ? formatDate(item.expireDate) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.location ?? '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openStock(item)} title="出入库" aria-label="出入库">
                          <ArrowLeftRight className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)} title="编辑" aria-label="编辑">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(item)}
                          title="删除"
                          className="text-destructive hover:text-destructive"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
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

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑库存物品' : '新建库存物品'}</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-code">编码 *</Label>
              <Input
                id="inv-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="如 RV001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">名称 *</Label>
              <Input
                id="inv-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 一次性手套"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-spec">规格</Label>
              <Input
                id="inv-spec"
                value={form.spec}
                onChange={(e) => setForm({ ...form, spec: e.target.value })}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-category">分类 *</Label>
              <Input
                id="inv-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="如 耗材"
                list="inv-category-list"
              />
              <datalist id="inv-category-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-unit">单位 *</Label>
              <Input
                id="inv-unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="如 个/盒"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-supplier">供应商</Label>
              <Select
                id="inv-supplier"
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              >
                <option value="">无</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-stock">初始库存</Label>
              <Input
                id="inv-stock"
                type="number"
                min="0"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                disabled={!!editing}
                placeholder="0"
              />
              {editing && (
                <p className="text-xs text-muted-foreground">库存通过出入库操作调整</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-min-stock">最低库存</Label>
              <Input
                id="inv-min-stock"
                type="number"
                min="0"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-price">单价 (元)</Label>
              <Input
                id="inv-price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-expire-date">有效期</Label>
              <Input
                id="inv-expire-date"
                type="date"
                value={form.expireDate}
                onChange={(e) => setForm({ ...form, expireDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-location">位置</Label>
              <Input
                id="inv-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="可选"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-remark">备注</Label>
            <Textarea
              id="inv-remark"
              rows={2}
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder="可选"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <LoadingButton
              onClick={handleSubmit}
              loading={createMut.isPending || updateMut.isPending}
              loadingText="保存中…"
            >
              保存
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 出入库操作弹窗 */}
      <Dialog open={!!stockTarget} onClose={() => setStockTarget(null)}>
        <DialogHeader>
          <DialogTitle>出入库操作</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          {stockTarget && (
            <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">物品</span>
                <span className="font-medium">
                  {stockTarget.name} ({stockTarget.code})
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-muted-foreground">当前库存</span>
                <span className="font-semibold text-primary">
                  {stockTarget.stock} {stockTarget.unit}
                </span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="stock-type">类型</Label>
              <Select
                id="stock-type"
                value={stockForm.type}
                onChange={(e) => setStockForm({ ...stockForm, type: e.target.value })}
              >
                <option value="IN">入库</option>
                <option value="OUT">出库</option>
                <option value="ADJUST">调整</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stock-quantity">数量 *</Label>
              <Input
                id="stock-quantity"
                type="number"
                min="1"
                value={stockForm.quantity}
                onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-unit-price">单价 (元)</Label>
            <Input
              id="stock-unit-price"
              type="number"
              min="0"
              step="0.01"
              value={stockForm.unitPrice}
              onChange={(e) => setStockForm({ ...stockForm, unitPrice: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-remark">备注</Label>
            <Textarea
              id="stock-remark"
              rows={2}
              value={stockForm.remark}
              onChange={(e) => setStockForm({ ...stockForm, remark: e.target.value })}
              placeholder="可选"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setStockTarget(null)}>
              取消
            </Button>
            <LoadingButton onClick={handleStock} loading={stockMut.isPending} loadingText="提交中…">
              确认
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-sm">
            确定要删除物品 <span className="font-medium">{deleteTarget?.name}</span>
            （{deleteTarget?.code}）吗？此操作不可撤销。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <LoadingButton
              variant="destructive"
              onClick={confirmDelete}
              loading={deleteMut.isPending}
              loadingText="删除中…"
            >
              删除
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TransactionsTab() {
  const [itemId, setItemId] = useState('');
  const { data, isLoading } = useInventoryTransactions(itemId || undefined);
  const { data: itemsData } = useInventoryItems({ pageSize: 200 });
  const items = itemsData?.items ?? [];
  const txs = data?.items ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="tx-filter-item" className="text-muted-foreground">物品</Label>
          <Select id="tx-filter-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-60">
            <option value="">全部物品</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.code})
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto text-sm text-muted-foreground">共 {txs.length} 条记录</div>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">时间</TableHead>
              <TableHead>物品名称</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead className="w-20 text-right">数量</TableHead>
              <TableHead className="w-28 text-right">单价</TableHead>
              <TableHead className="w-28 text-right">总额</TableHead>
              <TableHead className="w-24">操作员</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={8} />
            ) : txs.length === 0 ? (
              <EmptyState colSpan={8} text="暂无记录" />
            ) : (
              txs.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-muted-foreground">{formatDateTime(tx.createdAt)}</TableCell>
                  <TableCell className="font-medium">{tx.itemName ?? '-'}</TableCell>
                  <TableCell>
                    <Badge className={TX_TYPE_CLASS[tx.type]}>
                      {TX_TYPE_LABEL[tx.type] ?? tx.type}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      tx.type === 'OUT' ? 'text-destructive' : 'text-success'
                    }`}
                  >
                    {tx.type === 'OUT' ? '-' : '+'}
                    {tx.quantity}
                  </TableCell>
                  <TableCell className="text-right">¥{Number(tx.unitPrice).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-semibold">
                    ¥{Number(tx.totalAmount).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tx.operatorName ?? '-'}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.remark ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function LowStockTab() {
  const { data, isLoading } = useLowStockItems();
  const items = data ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          以下物品库存已低于最低库存量，请及时补货
        </div>
        <div className="text-sm text-muted-foreground">共 {items.length} 项</div>
      </div>
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-32">分类</TableHead>
              <TableHead className="w-20 text-right">库存</TableHead>
              <TableHead className="w-24 text-right">最低库存</TableHead>
              <TableHead className="w-16">单位</TableHead>
              <TableHead>供应商</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={7} />
            ) : items.length === 0 ? (
              <EmptyState colSpan={7} text="暂无低库存物品" />
            ) : (
              items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Badge className="bg-primary/10 text-primary font-mono">{i.code}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell>
                    <Badge className="bg-muted text-muted-foreground">{i.category}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-destructive">{i.stock}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{i.minStock}</TableCell>
                  <TableCell className="text-muted-foreground">{i.unit}</TableCell>
                  <TableCell className="text-muted-foreground">{i.supplierName ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
