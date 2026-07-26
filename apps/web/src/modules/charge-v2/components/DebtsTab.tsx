import { useState, useMemo } from 'react';
import {
  Search,
  Check,
  X,
  AlertCircle,
  Wallet,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Eye,
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
import {
  useDebts,
  useDebtStats,
  usePayDebt,
  usePaymentMethods,
  DEBT_STATUS_LABEL,
  DEBT_STATUS_COLOR,
  type DebtRecord,
  type PayDebtDto,
} from '@/lib/api/financial/charge-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const PAGE_SIZE = 10;

export function DebtsTab() {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState('');
  const [page, setPage] = useState(1);

  const [payOpen, setPayOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<DebtRecord | null>(null);

  const { data: statsData } = useDebtStats();
  const { data, isLoading } = useDebts({
    status: statusFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const payDebt = usePayDebt();

  const debts = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredDebts = useMemo(() => {
    if (!keyword) return debts;
    const kw = keyword.toLowerCase();
    return debts.filter(
      (d) =>
        d.patient?.name?.toLowerCase().includes(kw) ||
        d.patient?.phone?.includes(kw) ||
        d.charge?.number?.toLowerCase().includes(kw),
    );
  }, [debts, keyword]);

  function handlePay(debt: DebtRecord) {
    setSelectedDebt(debt);
    setPayOpen(true);
  }

  function handleViewDetail(debt: DebtRecord) {
    setSelectedDebt(debt);
    setDetailOpen(true);
  }

  const statsCards = [
    {
      label: '总欠费金额',
      value: `¥${Number(statsData?.totalRemain ?? 0).toFixed(2)}`,
      icon: Wallet,
      color: 'bg-destructive/10 text-destructive',
    },
    {
      label: '本月新增欠费',
      value: `¥${Number(statsData?.thisMonthNew ?? 0).toFixed(2)}`,
      icon: TrendingUp,
      color: 'bg-warning/10 text-warning',
    },
    {
      label: '本月已回收',
      value: `¥${Number(statsData?.thisMonthPaid ?? 0).toFixed(2)}`,
      icon: DollarSign,
      color: 'bg-success/10 text-success',
    },
    {
      label: '欠费笔数',
      value: statsData?.debtCount ?? 0,
      icon: AlertCircle,
      color: 'bg-primary/10 text-primary',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {statsCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                  <div className={`p-3 rounded-full ${stat.color}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索患者姓名/电话/单号"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-36"
            >
              <option value="">全部状态</option>
              <option value="PENDING">未结清</option>
              <option value="PARTIAL">部分还款</option>
              <option value="PAID">已结清</option>
            </Select>
            <Select
              value={dateRange}
              onChange={(e) => {
                setDateRange(e.target.value);
                setPage(1);
              }}
              className="w-36"
            >
              <option value="">全部时间</option>
              <option value="today">今天</option>
              <option value="week">本周</option>
              <option value="month">本月</option>
            </Select>
            <Button variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>患者</TableHead>
                <TableHead>原始单号</TableHead>
                <TableHead>欠费金额</TableHead>
                <TableHead>已还金额</TableHead>
                <TableHead>剩余金额</TableHead>
                <TableHead>欠费日期</TableHead>
                <TableHead>最后还款日</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={9} />
              ) : filteredDebts.length === 0 ? (
                <EmptyState colSpan={9} text="暂无数据" />
              ) : (
                filteredDebts.map((debt) => (
                  <TableRow key={debt.id}>
                    <TableCell>
                      <div className="font-medium">{debt.patient?.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {debt.patient?.phone}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {debt.charge?.number ?? '-'}
                    </TableCell>
                    <TableCell>¥{Number(debt.totalAmount).toFixed(2)}</TableCell>
                    <TableCell className="text-success">
                      ¥{Number(debt.paidAmount).toFixed(2)}
                    </TableCell>
                    <TableCell className="font-semibold text-destructive">
                      ¥{Number(debt.remainAmount).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(debt.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {debt.dueDate
                        ? format(new Date(debt.dueDate), 'yyyy-MM-dd', { locale: zhCN })
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge className={DEBT_STATUS_COLOR[debt.status]}>
                        {DEBT_STATUS_LABEL[debt.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleViewDetail(debt)}
                        aria-label="查看"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {debt.status !== 'PAID' && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handlePay(debt)}
                        >
                          <DollarSign className="w-3.5 h-3.5 mr-1" />
                          还款
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

      {selectedDebt && (
        <>
          <PayDebtDialog
            open={payOpen}
            onClose={() => {
              setPayOpen(false);
              setSelectedDebt(null);
            }}
            debt={selectedDebt}
            onPay={async (data) => {
              await payDebt.mutateAsync({ id: selectedDebt.id, data });
              setPayOpen(false);
              setSelectedDebt(null);
            }}
          />

          <DebtDetailDialog
            open={detailOpen}
            onClose={() => {
              setDetailOpen(false);
              setSelectedDebt(null);
            }}
            debt={selectedDebt}
            onPay={() => {
              setDetailOpen(false);
              setPayOpen(true);
            }}
          />
        </>
      )}
    </div>
  );
}

function PayDebtDialog({
  open,
  onClose,
  debt,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  debt: DebtRecord;
  onPay: (data: PayDebtDto) => Promise<void>;
}) {
  const remaining = Number(debt.remainAmount);
  const [amount, setAmount] = useState(remaining);
  const [payMethod, setPayMethod] = useState('WECHAT');
  const [remark, setRemark] = useState('');

  const { data: paymentMethodsData } = usePaymentMethods({ isEnabled: true });
  const paymentMethods = paymentMethodsData ?? [];

  async function handlePay() {
    if (amount <= 0 || amount > remaining) return;
    await onPay({
      amount,
      payMethod,
      remark,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>欠费还款</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">患者</div>
              <div className="font-medium">{debt.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">单号</div>
              <div className="font-mono">{debt.charge?.number ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">欠费总额</div>
              <div>¥{Number(debt.totalAmount).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">已还金额</div>
              <div className="text-success">¥{Number(debt.paidAmount).toFixed(2)}</div>
            </div>
          </div>

          <div className="p-4 bg-warning/5 rounded-md border border-warning/20 text-center">
            <div className="text-sm text-muted-foreground mb-1">待还金额</div>
            <div className="text-3xl font-bold text-warning">¥{remaining.toFixed(2)}</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-pay-amount">还款金额</Label>
            <Input
              id="debt-pay-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="text-lg font-semibold"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-pay-method">还款方式</Label>
            <Select
              id="debt-pay-method"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
            >
              {paymentMethods.length > 0 ? (
                paymentMethods.map((m) => (
                  <option key={m.id} value={m.code}>
                    {m.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="CASH">现金</option>
                  <option value="WECHAT">微信支付</option>
                  <option value="ALIPAY">支付宝</option>
                  <option value="CARD">银行卡</option>
                  <option value="OTHER">其他</option>
                </>
              )}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-remark">备注</Label>
            <Textarea
              id="debt-remark"
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
            <Button
              onClick={handlePay}
              disabled={amount <= 0 || amount > remaining}
            >
              <Check className="w-4 h-4 mr-2" />
              确认还款
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DebtDetailDialog({
  open,
  onClose,
  debt,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  debt: DebtRecord;
  onPay: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>欠费详情</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">患者姓名</div>
              <div className="font-medium mt-0.5">{debt.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">联系电话</div>
              <div className="mt-0.5">{debt.patient?.phone}</div>
            </div>
            <div>
              <div className="text-muted-foreground">患者编号</div>
              <div className="font-mono mt-0.5">{debt.patient?.code}</div>
            </div>
            <div>
              <div className="text-muted-foreground">关联单号</div>
              <div className="font-mono mt-0.5">{debt.charge?.number ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">欠费日期</div>
              <div className="mt-0.5">
                {format(new Date(debt.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">最后还款日</div>
              <div className="mt-0.5">
                {debt.dueDate
                  ? format(new Date(debt.dueDate), 'yyyy-MM-dd', { locale: zhCN })
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">状态</div>
              <div className="mt-0.5">
                <Badge className={DEBT_STATUS_COLOR[debt.status]}>
                  {DEBT_STATUS_LABEL[debt.status]}
                </Badge>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
            <div className="text-center p-3 bg-muted/30 rounded-md">
              <div className="text-sm text-muted-foreground">欠费总额</div>
              <div className="text-xl font-bold mt-1">
                ¥{Number(debt.totalAmount).toFixed(2)}
              </div>
            </div>
            <div className="text-center p-3 bg-success/5 rounded-md">
              <div className="text-sm text-muted-foreground">已还金额</div>
              <div className="text-xl font-bold mt-1 text-success">
                ¥{Number(debt.paidAmount).toFixed(2)}
              </div>
            </div>
            <div className="text-center p-3 bg-destructive/5 rounded-md">
              <div className="text-sm text-muted-foreground">剩余金额</div>
              <div className="text-xl font-bold mt-1 text-destructive">
                ¥{Number(debt.remainAmount).toFixed(2)}
              </div>
            </div>
          </div>

          {debt.remark && (
            <div className="space-y-1.5 pt-2">
              <Label>备注</Label>
              <p className="text-sm text-muted-foreground">{debt.remark}</p>
            </div>
          )}

          {debt.payments && debt.payments.length > 0 && (
            <div className="pt-2">
              <Label>还款记录</Label>
              <div className="mt-2 border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">还款时间</TableHead>
                      <TableHead className="text-xs">金额</TableHead>
                      <TableHead className="text-xs">方式</TableHead>
                      <TableHead className="text-xs">操作员</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debt.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {payment.paidAt ? format(new Date(payment.paidAt), 'yyyy-MM-dd HH:mm', {
                            locale: zhCN,
                          }) : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-success">
                          ¥{Number(payment.amount).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs">{payment.payMethod}</TableCell>
                        <TableCell className="text-xs">
                          {payment.operator?.name ?? '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            {debt.status !== 'PAID' && (
              <Button onClick={onPay}>
                <DollarSign className="w-4 h-4 mr-2" />
                立即还款
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
