import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Check,
  X,
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
  usePaymentMethods,
  useCreatePaymentMethod,
  useUpdatePaymentMethod,
  useDeletePaymentMethod,
  useTogglePaymentMethod,
  type PaymentMethod,
  type CreatePaymentMethodDto,
} from '@/lib/api/financial/charge-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const PAYMENT_METHOD_TYPES = [
  { value: 'CASH', label: '现金' },
  { value: 'CARD', label: '银行卡' },
  { value: 'WECHAT', label: '微信' },
  { value: 'ALIPAY', label: '支付宝' },
  { value: 'INSURANCE', label: '医保' },
  { value: 'OTHER', label: '其他' },
];

export function PaymentMethodsTab() {
  const isBoss = useIsBoss();
  const [keyword, setKeyword] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  const { data, isLoading } = usePaymentMethods();

  const createPaymentMethod = useCreatePaymentMethod();
  const updatePaymentMethod = useUpdatePaymentMethod();
  const deletePaymentMethod = useDeletePaymentMethod();
  const togglePaymentMethod = useTogglePaymentMethod();

  const methods = data ?? [];

  const filteredMethods = useMemo(() => {
    if (!keyword) return methods;
    const kw = keyword.toLowerCase();
    return methods.filter(
      (m: PaymentMethod) => m.name.toLowerCase().includes(kw) || m.code.toLowerCase().includes(kw),
    );
  }, [methods, keyword]);

  function handleEdit(method: PaymentMethod) {
    setSelectedMethod(method);
    setEditOpen(true);
  }

  function handleDelete(method: PaymentMethod) {
    setSelectedMethod(method);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!selectedMethod) return;
    await deletePaymentMethod.mutateAsync(selectedMethod.id);
    setDeleteOpen(false);
    setSelectedMethod(null);
  }

  function getTypeLabel(type: string) {
    const found = PAYMENT_METHOD_TYPES.find((t) => t.value === type);
    return found?.label ?? type;
  }

  function getTypeBadgeClass(type: string) {
    const colorMap: Record<string, string> = {
      CASH: 'bg-success/10 text-success border-success/30',
      CARD: 'bg-primary/10 text-primary border-primary/30',
      WECHAT: 'bg-green-500/10 text-green-600 border-green-500/30',
      ALIPAY: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
      INSURANCE: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
      OTHER: 'bg-muted text-muted-foreground border-muted',
    };
    return colorMap[type] ?? 'bg-muted text-muted-foreground border-muted';
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
                  placeholder="搜索缴费方式"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
            </div>
            <PermissionButton roles={['BOSS']}>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                新建方式
              </Button>
            </PermissionButton>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>方式名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>手续费率</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>排序</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={7} />
              ) : filteredMethods.length === 0 ? (
                <EmptyState colSpan={7} text="暂无数据" />
              ) : (
                filteredMethods.map((method) => (
                  <TableRow key={method.id}>
                    <TableCell className="font-medium">{method.name}</TableCell>
                    <TableCell>
                      <Badge className={getTypeBadgeClass(method.type)}>
                        {getTypeLabel(method.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => togglePaymentMethod.mutateAsync(method.id)}
                        className={
                          method.isEnabled
                            ? 'bg-success/10 text-success border-success/30'
                            : 'bg-muted text-muted-foreground border-muted'
                        }
                      >
                        {method.isEnabled ? '已启用' : '已停用'}
                      </Button>
                    </TableCell>
                    <TableCell>{method.sortOrder}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(method.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {isBoss && (
                        <Button size="sm" variant="ghost" onClick={() => handleEdit(method)} aria-label="编辑">
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {isBoss && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(method)}
                          aria-label="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

        </CardContent>
      </Card>

      <PaymentMethodDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (data) => {
          await createPaymentMethod.mutateAsync(data);
          setCreateOpen(false);
        }}
      />

      {selectedMethod && (
        <>
          <PaymentMethodDialog
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setSelectedMethod(null);
            }}
            method={selectedMethod}
            onSubmit={async (data) => {
              await updatePaymentMethod.mutateAsync({ id: selectedMethod.id, data });
              setEditOpen(false);
              setSelectedMethod(null);
            }}
          />

          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} className="max-w-md">
            <DialogHeader>
              <DialogTitle>删除缴费方式</DialogTitle>
            </DialogHeader>
            <DialogContent>
              <div className="space-y-4">
                <p className="text-sm">
                  确定要删除缴费方式{' '}
                  <span className="font-semibold">{selectedMethod.name}</span> 吗？此操作不可撤销。
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

function PaymentMethodDialog({
  open,
  onClose,
  method,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  method?: PaymentMethod;
  onSubmit: (data: CreatePaymentMethodDto) => Promise<void>;
}) {
  const [name, setName] = useState(method?.name ?? '');
  const [code, setCode] = useState(method?.code ?? '');
  const [type, setType] = useState(method?.type ?? 'CASH');
  const [sortOrder, setSortOrder] = useState(method?.sortOrder ?? 0);
  const [isEnabled, setIsEnabled] = useState(method?.isEnabled ?? true);
  const [remark, setRemark] = useState('');

  async function handleSubmit() {
    if (!name || !code) return;
    await onSubmit({
      name,
      code,
      type,
      sortOrder,
    });
  }

  const isValid = name && code;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{method ? '编辑缴费方式' : '新建缴费方式'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pm-name">方式名称</Label>
              <Input
                id="pm-name"
                placeholder="请输入方式名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-code">编码</Label>
              <Input
                id="pm-code"
                placeholder="请输入编码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pm-type">类型</Label>
              <Select id="pm-type" value={type} onChange={(e) => setType(e.target.value)}>
                {PAYMENT_METHOD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-sort-order">排序</Label>
              <Input
                id="pm-sort-order"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <Label>是否启用</Label>
              <p className="text-xs text-muted-foreground">停用后将无法在收费时选择此方式</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEnabled(!isEnabled)}
              className={isEnabled ? 'bg-success/10 text-success border-success/30' : ''}
            >
              {isEnabled ? '已启用' : '已停用'}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pm-remark">备注</Label>
            <Textarea
              id="pm-remark"
              placeholder="请输入备注（可选）"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid}>
              <Check className="w-4 h-4 mr-2" />
              {method ? '保存修改' : '创建方式'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
