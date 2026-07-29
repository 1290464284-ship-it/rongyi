import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
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
import { PermissionButton, useIsBoss } from '@/components/ui/permission';
import {
  useChargeCombos,
  useCreateChargeCombo,
  useUpdateChargeCombo,
  useDeleteChargeCombo,
  type ChargeCombo,
} from '@/lib/api/financial/charge-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ComboDialog, COMBO_CATEGORIES } from './ComboDialog';

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

  const combos = useMemo(() => data?.items ?? [], [data?.items]);
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
