import { useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useIsBoss } from '@/components/ui/permission';
import {
  useSuppliers,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  type Supplier,
} from '@/lib/api/inventory/suppliers';
import { toast } from 'sonner';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';

const PAGE_SIZE = 20;

interface FormState {
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  bankAccount: string;
  remark: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  contactPerson: '',
  phone: '',
  address: '',
  bankAccount: '',
  remark: '',
};

export default function SuppliersPage() {
  const isBoss = useIsBoss();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useSuppliers(keyword, page, PAGE_SIZE);

  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();
  const deleteMut = useDeleteSupplier();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: Supplier) => {
    setEditing(item);
    setForm({
      name: item.name,
      contactPerson: item.contactPerson ?? '',
      phone: item.phone ?? '',
      address: item.address ?? '',
      bankAccount: item.bankAccount ?? '',
      remark: item.remark ?? '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast.error('请填写供应商名称');
      return;
    }
    const payload = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      bankAccount: form.bankAccount.trim() || undefined,
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
          <h1 className="text-xl font-semibold">供应商管理</h1>
          <p className="text-sm text-muted-foreground mt-1">维护物资供应商信息</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />新建供应商
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="名称 / 联系人"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="ml-auto text-sm text-muted-foreground">共 {total} 家供应商</div>
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead className="w-28">联系人</TableHead>
                <TableHead className="w-36">电话</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-28 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={6}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={6} />
              ) : items.length === 0 ? (
                <EmptyState colSpan={6} text="暂无供应商" />
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.contactPerson ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.phone ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.address ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.remark ?? '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
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

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑供应商' : '新建供应商'}</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-name">名称 *</Label>
            <Input
              id="supplier-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="供应商名称"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-contact-person">联系人</Label>
              <Input
                id="supplier-contact-person"
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-phone">电话</Label>
              <Input
                id="supplier-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="可选"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-address">地址</Label>
            <Input
              id="supplier-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="可选"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-bank-account">银行账户</Label>
            <Input
              id="supplier-bank-account"
              value={form.bankAccount}
              onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
              placeholder="可选"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-remark">备注</Label>
            <Textarea
              id="supplier-remark"
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
            确定要删除供应商 <span className="font-medium">{deleteTarget?.name}</span>
            吗？此操作不可撤销。
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
