import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, ArrowLeftRight } from 'lucide-react';
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
  useInventoryItems,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useStockAction,
  type InventoryItem,
} from '@/lib/api/inventory/inventory';
import { useSuppliers } from '@/lib/api/inventory/suppliers';
import { formatDate, debounce } from '@/lib/utils';
import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';
import { toast } from 'sonner';
import { ItemFormDialog, EMPTY_FORM, type FormState } from './ItemFormDialog';
import { StockActionDialog, type StockFormState } from './StockActionDialog';

const PAGE_SIZE = 20;

export function InventoryListTab() {
  const isBoss = useIsBoss();
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

  const { data: suppliersData } = useSuppliers('', 1, DROPDOWN_MAX_PAGE_SIZE);
  const suppliers = suppliersData?.items ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [stockTarget, setStockTarget] = useState<InventoryItem | null>(null);
  const [stockForm, setStockForm] = useState<StockFormState>({
    type: 'IN',
    quantity: '',
    unitPrice: '',
    remark: '',
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
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
                        {isBoss && (
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
                        )}
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
      <ItemFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        isEditing={!!editing}
        form={form}
        setForm={setForm}
        categories={categories}
        suppliers={suppliers}
        onSubmit={handleSubmit}
        saving={createMut.isPending || updateMut.isPending}
      />

      {/* 出入库操作弹窗 */}
      <StockActionDialog
        target={stockTarget}
        onClose={() => setStockTarget(null)}
        form={stockForm}
        setForm={setStockForm}
        onSubmit={handleStock}
        saving={stockMut.isPending}
      />

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
