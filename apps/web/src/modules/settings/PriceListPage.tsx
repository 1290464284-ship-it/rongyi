import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
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
  useTreatmentCatalog,
  useCreateTreatmentCatalogItem,
  useUpdateTreatmentCatalogItem,
  useDeleteTreatmentCatalogItem,
  type TreatmentCatalogItem,
} from '@/lib/treatment-catalog';
import { toast } from 'sonner';

interface FormState {
  code: string;
  name: string;
  category: string;
  price: string;
  remark: string;
}

const EMPTY_FORM: FormState = { code: '', name: '', category: '', price: '', remark: '' };

export default function PriceListPage() {
  const { data, isLoading } = useTreatmentCatalog();
  const createMut = useCreateTreatmentCatalogItem();
  const updateMut = useUpdateTreatmentCatalogItem();
  const deleteMut = useDeleteTreatmentCatalogItem();

  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [keyword, setKeyword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TreatmentCatalogItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<TreatmentCatalogItem | null>(null);

  const items = data?.items ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(item.category || '未分类'));
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (categoryFilter !== 'ALL') {
      list = list.filter((i) => (i.category || '未分类') === categoryFilter);
    }
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.code.toLowerCase().includes(kw) ||
          i.name.toLowerCase().includes(kw) ||
          (i.remark ?? '').toLowerCase().includes(kw),
      );
    }
    return list;
  }, [items, categoryFilter, keyword]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: TreatmentCatalogItem) => {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      price: String(item.price ?? ''),
      remark: item.remark ?? '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.code.trim() || !form.name.trim() || !form.category.trim()) {
      toast.error('请填写编号、名称和类别');
      return;
    }
    const price = parseFloat(form.price);
    if (isNaN(price) || price < 0) {
      toast.error('价格格式不正确');
      return;
    }
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      price,
      remark: form.remark.trim() || undefined,
    };
    if (editing) {
      updateMut.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('已更新');
            setDialogOpen(false);
          },
        },
      );
    } else {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success('已新增');
          setDialogOpen(false);
        },
      });
    }
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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">价目表管理</h1>
          <p className="text-sm text-muted-foreground mt-1">维护诊所收费项目目录</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />新增项目
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="pl-filter-category" className="text-muted-foreground">类别</Label>
            <Select
              id="pl-filter-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-40"
            >
              <option value="ALL">全部类别</option>
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
              placeholder="编号 / 名称 / 备注"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="ml-auto text-sm text-muted-foreground">共 {filtered.length} 项</div>
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">编号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead className="w-32">类别</TableHead>
                <TableHead className="w-32 text-right">价格</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-28 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={6} />
              ) : filtered.length === 0 ? (
                <EmptyState colSpan={6} text="暂无收费项目" />
              ) : (
                filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge className="bg-primary/10 text-primary font-mono">{item.code}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge className="bg-muted text-muted-foreground">{item.category || '未分类'}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      ¥{Number(item.price).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.remark ?? '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(item)}
                          title="编辑"
                          aria-label="编辑"
                        >
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑收费项目' : '新增收费项目'}</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pl-code">编号 *</Label>
              <Input
                id="pl-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="如 D001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-category">类别 *</Label>
              <Input
                id="pl-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="如 拔牙"
                list="price-category-list"
              />
              <datalist id="price-category-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-name">名称 *</Label>
            <Input
              id="pl-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如 普通拔牙"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-price">价格 (元) *</Label>
            <Input
              id="pl-price"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-remark">备注</Label>
            <Textarea
              id="pl-remark"
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

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-sm">
            确定要删除收费项目 <span className="font-medium">{deleteTarget?.name}</span>
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
    </div>
  );
}
