import { useState, useMemo, useCallback } from 'react';
import {
  Search,
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
import { TableLoading, EmptyState } from '@/components/ui/loading';
import {
  useDebts,
  useDebtStats,
  usePayDebt,
  DEBT_STATUS_LABEL,
  DEBT_STATUS_COLOR,
  type DebtRecord,
} from '@/lib/api/financial/charge-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { PayDebtDialog } from './PayDebtDialog';
import { DebtDetailDialog } from './DebtDetailDialog';

const PAGE_SIZE = 10;

export function DebtsTab() {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState('');
  const [page, setPage] = useState(1);

  const [payOpen, setPayOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<DebtRecord | null>(null);

  // 关键字防抖：350ms 后才发送服务端请求
  const keywordTimerRef = useMemo(() => ({ current: 0 as unknown as ReturnType<typeof setTimeout> }), []);
  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    clearTimeout(keywordTimerRef.current);
    keywordTimerRef.current = setTimeout(() => {
      setDebouncedKeyword(value);
      setPage(1);
    }, 350);
  }, [keywordTimerRef]);

  // 日期范围计算
  const dateParams = useMemo(() => {
    if (!dateRange) return {};
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (dateRange === 'today') return { startDate: todayStr, endDate: todayStr };
    if (dateRange === 'week') {
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - day + 1);
      return { startDate: monday.toISOString().slice(0, 10), endDate: todayStr };
    }
    if (dateRange === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: firstDay.toISOString().slice(0, 10), endDate: todayStr };
    }
    return {};
  }, [dateRange]);

  const { data: statsData } = useDebtStats();
  const { data, isLoading } = useDebts({
    status: statusFilter || undefined,
    keyword: debouncedKeyword || undefined,
    ...dateParams,
    page,
    pageSize: PAGE_SIZE,
  });

  const payDebt = usePayDebt();

  const debts = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // 服务端已做筛选，前端无需再过滤
  const filteredDebts = debts;

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
                onChange={(e) => handleKeywordChange(e.target.value)}
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
