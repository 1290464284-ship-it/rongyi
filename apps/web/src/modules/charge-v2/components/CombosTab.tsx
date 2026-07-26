import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
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
import { PermissionButton, useIsBoss } from '@/components/ui/permission';
import {
  useChargeCombos,
  useCreateChargeCombo,
  useUpdateChargeCombo,
  useDeleteChargeCombo,
  type ChargeCombo,
  type CreateChargeComboDto,
} from '@/lib/api/financial/charge-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const COMBO_CATEGORIES = [
  '基础治疗',
  '修复治疗',
  '正畸治疗',
  '种植治疗',
  '美白治疗',
  '儿童牙科',
  '其他',
];

const PAGE_SIZE = 10;

export function ChargeCombosTab() {
  const isBoss = useIsBoss();
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedCombo, setSelectedCombo] = useState<ChargeCombo | null>(null);

  const { data, isLoading } = useChargeCombos({
    page,
    pageSize: PAGE_SIZE,
  });

  const createChargeCombo = useCreateChargeCombo();
  const updateChargeCombo = useUpdateChargeCombo();
  const deleteChargeCombo = useDeleteChargeCombo();

  const combos = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredCombos = useMemo(() => {
    let result = combos;
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(kw));
    }
    if (categoryFilter) {
      result = result.filter((c) => c.category === categoryFilter);
    }
    return result;
  }, [combos, keyword, categoryFilter]);

  function handleEdit(combo: ChargeCombo) {
    setSelectedCombo(combo);
    setEditOpen(true);
  }

  function handleDelete(combo: ChargeCombo) {
    setSelectedCombo(combo);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!selectedCombo) return;
    await deleteChargeCombo.mutateAsync(selectedCombo.id);
    setDeleteOpen(false);
    setSelectedCombo(null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索组合名称"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
                className="w-36"
              >
                <option value="">全部分类</option>
                {COMBO_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>
            <PermissionButton roles={['BOSS']}>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                新建组合
              </Button>
            </PermissionButton>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>组合名称</TableHead>
                <TableHead>分类</TableHead>
                <TableHead>原价</TableHead>
                <TableHead>优惠价</TableHead>
                <TableHead>折扣率</TableHead>
                <TableHead>包含项目</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={9} />
              ) : filteredCombos.length === 0 ? (
                <EmptyState colSpan={9} text="暂无数据" />
              ) : (
                filteredCombos.map((combo) => {
                  const totalPrice = Number(combo.totalPrice);
                  const discountPrice = Number(combo.discountPrice);
                  const discountRate =
                    totalPrice > 0 ? ((totalPrice - discountPrice) / totalPrice) * 100 : 0;
                  return (
                    <TableRow key={combo.id}>
                      <TableCell className="font-medium">{combo.name}</TableCell>
                      <TableCell>
                        <Badge className="border border-border bg-transparent">{combo.category}</Badge>
                      </TableCell>
                      <TableCell className="line-through text-muted-foreground">
                        ¥{totalPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="font-semibold text-primary">
                        ¥{discountPrice.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {discountRate > 0 ? (
                          <Badge className="bg-destructive/10 text-destructive border-destructive/30">
                            -{discountRate.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{combo.items.length} 项</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            combo.isActive
                              ? 'bg-success/10 text-success border-success/30'
                              : 'bg-muted text-muted-foreground border-muted'
                          }
                        >
                          {combo.isActive ? '启用' : '停用'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(combo.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {isBoss && (
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(combo)} aria-label="编辑">
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {isBoss && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(combo)}
                            aria-label="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="上一页"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="下一页"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ComboDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (data) => {
          await createChargeCombo.mutateAsync(data);
          setCreateOpen(false);
        }}
      />

      {selectedCombo && (
        <>
          <ComboDialog
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setSelectedCombo(null);
            }}
            combo={selectedCombo}
            onSubmit={async (data) => {
              await updateChargeCombo.mutateAsync({ id: selectedCombo.id, data });
              setEditOpen(false);
              setSelectedCombo(null);
            }}
          />

          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} className="max-w-md">
            <DialogHeader>
              <DialogTitle>删除收费组合</DialogTitle>
            </DialogHeader>
            <DialogContent>
              <div className="space-y-4">
                <p className="text-sm">
                  确定要删除收费组合 <span className="font-semibold">{selectedCombo.name}</span>{' '}
                  吗？此操作不可撤销。
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    取消
                  </Button>
                  <Button variant="destructive" onClick={confirmDelete}>
                    确认删除
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

interface ComboItemInput {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: number;
}

function ComboDialog({
  open,
  onClose,
  combo,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  combo?: ChargeCombo;
  onSubmit: (data: CreateChargeComboDto) => Promise<void>;
}) {
  const [name, setName] = useState(combo?.name ?? '');
  const [category, setCategory] = useState(combo?.category ?? COMBO_CATEGORIES[0]);
  const [description, setDescription] = useState(combo?.description ?? '');
  const [isActive, setIsActive] = useState(combo?.isActive ?? true);
  const [items, setItems] = useState<ComboItemInput[]>(
    combo?.items?.length
      ? combo.items.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          price: String(i.price),
          quantity: i.quantity,
        }))
      : [{ id: '1', name: '', category: '', price: '0', quantity: 1 }],
  );

  const totalPrice = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [items],
  );

  function addItem() {
    setItems([
      ...items,
      { id: Date.now().toString(), name: '', category: '', price: '0', quantity: 1 },
    ]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter((i) => i.id !== id));
  }

  function updateItem(
    id: string,
    field: keyof ComboItemInput,
    value: ComboItemInput[keyof ComboItemInput],
  ) {
    setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function handleSubmit() {
    if (!name || items.some((i) => !i.name || Number(i.price) <= 0)) return;
    await onSubmit({
      name,
      category,
      description,
      discountPrice: totalPrice,
      items: items.map(({ id: _id, ...rest }) => rest) as any,
    });
  }

  const isValid = name && items.every((i) => i.name && Number(i.price) > 0 && i.quantity > 0);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{combo ? '编辑收费组合' : '新建收费组合'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="combo-name">组合名称</Label>
              <Input
                id="combo-name"
                placeholder="请输入组合名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="combo-category">分类</Label>
              <Select id="combo-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {COMBO_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="combo-description">描述</Label>
            <Textarea
              id="combo-description"
              placeholder="请输入组合描述（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>启用状态</Label>
              <p className="text-xs text-muted-foreground">停用后将无法在收费时选择此组合</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsActive(!isActive)}
              className={isActive ? 'bg-success/10 text-success border-success/30' : ''}
            >
              {isActive ? '已启用' : '已停用'}
            </Button>
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>包含项目</Label>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> 添加项目
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 border border-border rounded-md"
                >
                  <span className="text-sm text-muted-foreground w-6">{idx + 1}</span>
                  <Input
                    placeholder="项目名称"
                    value={item.name}
                    onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="类别"
                    value={item.category}
                    onChange={(e) => updateItem(item.id, 'category', e.target.value)}
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="单价"
                    value={item.price || ''}
                    onChange={(e) => updateItem(item.id, 'price', e.target.value)}
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="数量"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(item.id, 'quantity', Number(e.target.value))
                    }
                    className="w-20"
                  />
                  <span className="text-sm w-20 text-right">
                    ¥{(Number(item.price) * item.quantity).toFixed(2)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="flex justify-between font-semibold text-lg">
              <span>总价（原价）</span>
              <span className="text-primary">¥{totalPrice.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid}>
              <Check className="w-4 h-4 mr-2" />
              {combo ? '保存修改' : '创建组合'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
