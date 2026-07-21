import { useState, useMemo, useEffect } from 'react';
import { Plus, Search, CreditCard, ArrowLeftRight, Trash2, Check, X, User } from 'lucide-react';
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
import {
  useCharges,
  useCreateCharge,
  usePayCharge,
  useRefundCharge,
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_COLOR,
  PAY_METHOD_LABEL,
  type PayMethod,
  type ChargeStatus,
  type CreateChargeDto,
} from '@/lib/charges';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { toastService } from '@/lib/toast-service';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Charge } from '@/lib/charges';

interface EditableItem {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: number;
  teethNumbers: number[];
}

const DEFAULT_ITEMS: EditableItem[] = [
  { id: '1', name: '', category: '', price: '0', quantity: 1, teethNumbers: [] },
];

export default function ChargePage() {
  const [statusFilter, setStatusFilter] = useState<ChargeStatus | ''>('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);

  // 搜索关键字去抖
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const { data, isLoading } = useCharges({
    status: statusFilter || undefined,
    keyword: debouncedKeyword || undefined,
    page,
    pageSize,
  });

  const createCharge = useCreateCharge();
  const payCharge = usePayCharge();
  const refundCharge = useRefundCharge();

  const charges = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function handlePay(charge: Charge) {
    setSelectedCharge(charge);
    setPayOpen(true);
  }

  function handleRefund(charge: Charge) {
    setSelectedCharge(charge);
    setRefundOpen(true);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">收费收银</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建收费单
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索单号/患者姓名/电话"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as ChargeStatus | '');
                setPage(1);
              }}
              className="w-36"
            >
              <option value="">全部状态</option>
              <option value="UNPAID">待支付</option>
              <option value="PARTIAL">部分支付</option>
              <option value="PAID">已支付</option>
              <option value="REFUNDED">已退款</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>单号</TableHead>
                <TableHead>患者</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>已付</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>支付方式</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={8} />
              ) : charges.length === 0 ? (
                <EmptyState colSpan={8} text="暂无收费记录" />
              ) : (
                charges.map(charge => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-mono text-sm">{charge.number}</TableCell>
                    <TableCell>
                      <div>{charge.patient?.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {charge.patient?.phone}
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">
                      ¥{Number(charge.totalAmount).toFixed(2)}
                    </TableCell>
                    <TableCell>¥{Number(charge.paidAmount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={CHARGE_STATUS_COLOR[charge.status]}>
                        {CHARGE_STATUS_LABEL[charge.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {charge.payMethod ? PAY_METHOD_LABEL[charge.payMethod] : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(charge.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {(charge.status === 'UNPAID' || charge.status === 'PARTIAL') && (
                        <Button size="sm" variant="default" onClick={() => handlePay(charge)}>
                          <CreditCard className="w-3 h-3 mr-1" />
                          收款
                        </Button>
                      )}
                      {charge.status === 'PAID' && (
                        <Button size="sm" variant="outline" onClick={() => handleRefund(charge)}>
                          <ArrowLeftRight className="w-3 h-3 mr-1" />
                          退款
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateChargeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createCharge.mutateAsync}
        isPending={createCharge.isPending}
      />

      {selectedCharge && (
        <>
          <PayDialog
            open={payOpen}
            onClose={() => setPayOpen(false)}
            charge={selectedCharge}
            onPay={payCharge.mutateAsync}
            isPending={payCharge.isPending}
          />
          <RefundDialog
            open={refundOpen}
            onClose={() => setRefundOpen(false)}
            charge={selectedCharge}
            onRefund={refundCharge.mutateAsync}
            isPending={refundCharge.isPending}
          />
        </>
      )}
    </div>
  );
}

function CreateChargeDialog({
  open,
  onClose,
  onCreate,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateChargeDto) => Promise<Charge>;
  isPending: boolean;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [items, setItems] = useState<EditableItem[]>(DEFAULT_ITEMS);
  const [discount, setDiscount] = useState(0);

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [items],
  );
  const total = Math.max(0, subtotal - discount);

  function addItem() {
    setItems([...items, { id: Date.now().toString(), name: '', category: '', price: '0', quantity: 1, teethNumbers: [] }]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter(i => i.id !== id));
  }

  function updateItem(id: string, field: keyof EditableItem, value: EditableItem[keyof EditableItem]) {
    setItems(items.map(i => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function handleSubmit() {
    if (!patientId || items.some(i => !i.name || Number(i.price) <= 0)) return;
    try {
      await onCreate({
        patientId,
        items: items.map(({ id: _id, ...rest }) => rest),
        discount,
      });
      toastService.success('收费单创建成功');
      onClose();
    } catch (e: any) {
      toastService.error('创建收费单失败', e);
    }
  }

  // 完整重置表单
  useEffect(() => {
    if (open) {
      setPatientId('');
      setPatientName('');
      setItems(DEFAULT_ITEMS);
      setDiscount(0);
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建收费单</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>患者</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <User className="w-4 h-4 mr-2" />
                {patientName ? patientName : '请选择患者'}
              </Button>
            </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>收费项目</Label>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> 添加项目
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 p-2 border border-border rounded-md">
                  <span className="text-sm text-muted-foreground w-6">{idx + 1}</span>
                  <Input
                    placeholder="项目名称"
                    value={item.name}
                    onChange={e => updateItem(item.id, 'name', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="类别"
                    value={item.category}
                    onChange={e => updateItem(item.id, 'category', e.target.value)}
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="单价"
                    value={item.price || ''}
                    onChange={e => updateItem(item.id, 'price', Number(e.target.value))}
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="数量"
                    value={item.quantity}
                    onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
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
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">小计</span>
              <span>¥{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">优惠减免</span>
              <div className="flex items-center gap-2">
                <span>¥</span>
                <Input
                  type="number"
                  value={discount || ''}
                  onChange={e => setDiscount(Number(e.target.value))}
                  className="w-24 text-right"
                />
              </div>
            </div>
            <div className="flex justify-between font-semibold text-lg pt-2 border-t border-border">
              <span>应收金额</span>
              <span className="text-primary">¥{total.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <LoadingButton onClick={handleSubmit} loading={isPending} loadingText="创建中..." disabled={!patientId || items.every(i => !i.name)}>
              <Check className="w-4 h-4 mr-2" />
              创建收费单
            </LoadingButton>
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

function PayDialog({
  open,
  onClose,
  charge,
  onPay,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  charge: Charge;
  onPay: ({ id, amount, payMethod }: { id: string; amount: number; payMethod: PayMethod }) => Promise<Charge>;
  isPending: boolean;
}) {
  const remaining = Number(charge.totalAmount) - Number(charge.paidAmount);
  const [amount, setAmount] = useState(remaining);
  const [payMethod, setPayMethod] = useState<PayMethod>('WECHAT');

  // 当 charge 变化时（dialog 复用场景），重置 amount 为新的 remaining
  useEffect(() => {
    if (open) {
      setAmount(remaining);
      setPayMethod('WECHAT');
    }
  }, [open, charge.id]);

  async function handlePay() {
    if (amount <= 0) return;
    try {
      await onPay({ id: charge.id, amount, payMethod });
      toastService.success('收款成功');
      onClose();
    } catch (e: any) {
      toastService.error('收款失败', e);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>收款</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">单号</div>
              <div className="font-mono">{charge.number}</div>
            </div>
            <div>
              <div className="text-muted-foreground">患者</div>
              <div>{charge.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">应收金额</div>
              <div>¥{Number(charge.totalAmount).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">已付金额</div>
              <div>¥{Number(charge.paidAmount).toFixed(2)}</div>
            </div>
          </div>
          <div className="p-4 bg-warning/5 rounded-md border border-warning/20 text-center">
            <div className="text-sm text-muted-foreground mb-1">待收金额</div>
            <div className="text-3xl font-bold text-warning">¥{remaining.toFixed(2)}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">收款金额</Label>
            <Input
              id="pay-amount"
              type="number"
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="text-lg font-semibold"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">支付方式</Label>
            <Select id="pay-method" value={payMethod} onChange={e => setPayMethod(e.target.value as PayMethod)}>
              <option value="CASH">现金</option>
              <option value="WECHAT">微信支付</option>
              <option value="ALIPAY">支付宝</option>
              <option value="CARD">银行卡</option>
              <option value="OTHER">其他</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <LoadingButton onClick={handlePay} loading={isPending} loadingText="处理中..." disabled={amount <= 0 || amount > remaining}>
              <Check className="w-4 h-4 mr-2" />
              确认收款
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  onClose,
  charge,
  onRefund,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  charge: Charge;
  onRefund: ({ id, remark }: { id: string; remark?: string }) => Promise<Charge>;
  isPending: boolean;
}) {
  const [remark, setRemark] = useState('');

  useEffect(() => {
    if (open) setRemark('');
  }, [open, charge.id]);

  async function handleRefund() {
    try {
      await onRefund({ id: charge.id, remark });
      toastService.success('退款成功');
      onClose();
    } catch (e: any) {
      toastService.error('退款失败', e);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>退款</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">单号</div>
              <div className="font-mono">{charge.number}</div>
            </div>
            <div>
              <div className="text-muted-foreground">患者</div>
              <div>{charge.patient?.name}</div>
            </div>
          </div>
          <div className="p-4 bg-destructive/5 rounded-md border border-destructive/20 text-center">
            <div className="text-sm text-muted-foreground mb-1">退款金额</div>
            <div className="text-3xl font-bold text-destructive">
              ¥{Number(charge.paidAmount).toFixed(2)}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-remark">退款原因（可选）</Label>
            <Input
              id="refund-remark"
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="请输入退款原因"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <LoadingButton variant="destructive" onClick={handleRefund} loading={isPending} loadingText="处理中...">
              确认退款
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
