import React, { lazy, Suspense, useState } from 'react';
import {
  TrendingUp,
  BarChart3,
  Stethoscope,
  CreditCard,
  Users,
  Package,
  AlertTriangle,
  CalendarClock,
  Wallet,
  Award,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { Badge } from '@/components/ui/badge';
import {
  useRevenue,
  usePatientGrowth,
  useRevenueByCategory,
  useRevenueByDoctor,
  useInventoryStatus,
  useAppointmentStatusStats,
  useMemberStats,
} from '@/lib/api/system/stats';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/api/clinical/appointments';
import { format, subDays, subMonths } from 'date-fns';

const RevenueLineChart = lazy(() => import('./charts/RevenueLineChart'));
const CategoryPieChart = lazy(() => import('./charts/CategoryPieChart'));
const PayMethodDoughnutChart = lazy(() => import('./charts/PayMethodDoughnutChart'));
const PatientGrowthChart = lazy(() => import('./charts/PatientGrowthChart'));
const RevenueCategoryPieChart = lazy(() => import('./charts/RevenueCategoryPieChart'));
const RevenueDoctorBarChart = lazy(() => import('./charts/RevenueDoctorBarChart'));
const AppointmentPieChart = lazy(() => import('./charts/AppointmentPieChart'));
const MemberLevelPieChart = lazy(() => import('./charts/MemberLevelPieChart'));

const SuspenseChart = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="text-center text-muted-foreground py-8">加载中...</div>}>
    {children}
  </Suspense>
);

type TabKey =
  | 'revenue'
  | 'patientGrowth'
  | 'revenueCategory'
  | 'revenueDoctor'
  | 'inventory'
  | 'appointment'
  | 'member';

const ReportPage = React.memo(function ReportPage() {
  const [tab, setTab] = useState<TabKey>('revenue');
  const today = new Date();
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'year'>('day');

  const startDate =
    range === 'week'
      ? format(subDays(today, 7), 'yyyy-MM-dd')
      : range === 'month'
        ? format(subMonths(today, 1), 'yyyy-MM-dd')
        : format(new Date(today.getFullYear(), 0, 1), 'yyyy-MM-dd');
  const endDate = format(today, 'yyyy-MM-dd');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'revenue', label: '收入趋势' },
    { key: 'patientGrowth', label: '患者增长' },
    { key: 'revenueCategory', label: '收入分类分析' },
    { key: 'revenueDoctor', label: '收入医生分布' },
    { key: 'inventory', label: '库存状态' },
    { key: 'appointment', label: '预约统计' },
    { key: 'member', label: '会员统计' },
  ];

  const dateRange = { startDate, endDate };

  return (
    <div className='p-6 space-y-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>经营报表</h1>
        <div className='flex items-center gap-3'>
          <Select
            value={range}
            onChange={(e) => {
              const v = e.target.value as 'week' | 'month' | 'year';
              setRange(v);
              setGroupBy(v === 'year' ? 'month' : 'day');
            }}
            className='w-32'
          >
            <option value='week'>近一周</option>
            <option value='month'>近一月</option>
            <option value='year'>本年度</option>
          </Select>
        </div>
      </div>

      <div className='flex items-center gap-1 border-b border-border overflow-x-auto'>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'revenue' && (
        <RevenueTab startDate={startDate} endDate={endDate} groupBy={groupBy} setGroupBy={setGroupBy} />
      )}
      {tab === 'patientGrowth' && <PatientGrowthTab dateRange={dateRange} />}
      {tab === 'revenueCategory' && <RevenueCategoryTab dateRange={dateRange} />}
      {tab === 'revenueDoctor' && <RevenueDoctorTab dateRange={dateRange} />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'appointment' && <AppointmentTab dateRange={dateRange} />}
      {tab === 'member' && <MemberTab />}
    </div>
  );
});
export default ReportPage;

function RevenueTab({
  startDate,
  endDate,
  groupBy,
  setGroupBy,
}: {
  startDate: string;
  endDate: string;
  groupBy: 'day' | 'month' | 'year';
  setGroupBy: (v: 'day' | 'month' | 'year') => void;
}) {
  const { data: revenue, isLoading: revLoading } = useRevenue({ startDate, endDate, groupBy });

  return (
    <>
      <div className='grid grid-cols-4 gap-4'>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm text-muted-foreground'>总营收</div>
                <div className='text-2xl font-bold text-success mt-1'>¥{revenue?.summary?.totalRevenue ?? '0'}</div>
              </div>
              <TrendingUp className='w-8 h-8 text-success/30' />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm text-muted-foreground'>收费笔数</div>
                <div className='text-2xl font-bold mt-1'>{revenue?.summary?.totalCount ?? 0}</div>
              </div>
              <CreditCard className='w-8 h-8 text-primary/30' />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm text-muted-foreground'>优惠总额</div>
                <div className='text-2xl font-bold text-warning mt-1'>¥{revenue?.summary?.totalDiscount ?? '0'}</div>
              </div>
              <BarChart3 className='w-8 h-8 text-warning/30' />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm text-muted-foreground'>客单价</div>
                <div className='text-2xl font-bold text-primary mt-1'>¥{revenue?.summary?.avgPerOrder ?? '0'}</div>
              </div>
              <Stethoscope className='w-8 h-8 text-primary/30' />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>营收趋势</span>
            <Select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'day' | 'month' | 'year')}
              className='w-28'
            >
              <option value='day'>按日</option>
              <option value='month'>按月</option>
              <option value='year'>按年</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <RevenueLineChart data={revenue} loading={revLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>

      <div className='grid grid-cols-2 gap-6'>
        <Card>
          <CardHeader className='pb-3'>
            <span className='text-sm font-medium'>收费项目分类</span>
          </CardHeader>
          <CardContent>
            <SuspenseChart>
              <CategoryPieChart data={revenue} />
            </SuspenseChart>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <span className='text-sm font-medium'>支付方式分布</span>
          </CardHeader>
          <CardContent>
            <SuspenseChart>
              <PayMethodDoughnutChart data={revenue} />
            </SuspenseChart>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function PatientGrowthTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
  const { data, isLoading } = usePatientGrowth(dateRange);

  return (
    <>
      <div className='grid grid-cols-2 gap-4'>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm text-muted-foreground'>区间新增患者</div>
                <div className='text-2xl font-bold text-primary mt-1'>
                  {data?.items?.reduce((s, i) => s + i.count, 0) ?? 0}
                </div>
              </div>
              <Users className='w-8 h-8 text-primary/30' />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm text-muted-foreground'>累计患者总数</div>
                <div className='text-2xl font-bold text-success mt-1'>{data?.total ?? 0}</div>
              </div>
              <TrendingUp className='w-8 h-8 text-success/30' />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <span className='text-sm font-medium'>患者增长趋势</span>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <PatientGrowthChart data={data} loading={isLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>
    </>
  );
}

function RevenueCategoryTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
  const { data, isLoading, isError, refetch } = useRevenueByCategory(dateRange);
  const list = data ?? [];
  const total = list.reduce((s: number, i: { amount: number }) => s + i.amount, 0);

  return (
    <>
      <Card>
        <CardHeader className='pb-3'>
          <span className='text-sm font-medium'>各治疗类别收入占比</span>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <RevenueCategoryPieChart data={list} loading={isLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>收入分类明细</span>
            <span className='text-sm text-muted-foreground'>合计 ¥{total.toFixed(2)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类别</TableHead>
                <TableHead className='text-right'>笔数</TableHead>
                <TableHead className='text-right'>金额</TableHead>
                <TableHead className='text-right'>占比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={4}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={4} />
              ) : list.length === 0 ? (
                <EmptyState colSpan={4} text="暂无数据" />
              ) : (
                list.map((c) => (
                  <TableRow key={c.category}>
                    <TableCell className='font-medium'>{c.category}</TableCell>
                    <TableCell className='text-right'>{c.count}</TableCell>
                    <TableCell className='text-right font-semibold text-success'>¥{Number(c.amount).toFixed(2)}</TableCell>
                    <TableCell className='text-right text-muted-foreground'>{c.percentage.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function RevenueDoctorTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
  const { data, isLoading, isError, refetch } = useRevenueByDoctor(dateRange);
  const list = data ?? [];
  const total = list.reduce((s: number, i: { amount: number }) => s + i.amount, 0);

  return (
    <>
      <Card>
        <CardHeader className='pb-3'>
          <span className='text-sm font-medium'>收入医生分布</span>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <RevenueDoctorBarChart data={list} loading={isLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>收入医生分布明细</span>
            <span className='text-sm text-muted-foreground'>合计 ¥{total.toFixed(2)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>医生</TableHead>
                <TableHead className='text-right'>笔数</TableHead>
                <TableHead className='text-right'>收入</TableHead>
                <TableHead className='text-right'>占比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={4}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={4} />
              ) : list.length === 0 ? (
                <EmptyState colSpan={4} text="暂无数据" />
              ) : (
                list.map((d) => (
                  <TableRow key={d.doctorId}>
                    <TableCell className='font-medium'>{d.doctorName}</TableCell>
                    <TableCell className='text-right'>{d.count}</TableCell>
                    <TableCell className='text-right font-semibold text-success'>¥{Number(d.amount).toFixed(2)}</TableCell>
                    <TableCell className='text-right text-muted-foreground'>{d.percentage.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function InventoryTab() {
  const { data, isLoading, isError, refetch } = useInventoryStatus();

  const cards = [
    {
      label: '总项目',
      value: data?.totalItems ?? 0,
      icon: <Package className='w-8 h-8 text-primary/30' />,
      color: 'text-primary',
    },
    {
      label: '低库存',
      value: data?.lowStockCount ?? 0,
      icon: <AlertTriangle className='w-8 h-8 text-warning/30' />,
      color: 'text-warning',
    },
    {
      label: '即将过期',
      value: data?.expiringSoonCount ?? 0,
      icon: <CalendarClock className='w-8 h-8 text-warning/30' />,
      color: 'text-warning',
    },
    {
      label: '已过期',
      value: data?.expiredCount ?? 0,
      icon: <AlertTriangle className='w-8 h-8 text-destructive/30' />,
      color: 'text-destructive',
    },
  ];

  return (
    <>
      <div className='grid grid-cols-4 gap-4'>
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='text-sm text-muted-foreground'>{c.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</div>
                </div>
                {c.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>低库存明细</span>
            <span className='text-sm text-muted-foreground'>共 {data?.lowStockItems?.length ?? 0} 项</span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-32'>编码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead className='w-20 text-right'>库存</TableHead>
                <TableHead className='w-24 text-right'>最低库存</TableHead>
                <TableHead className='w-16'>单位</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={5}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={5} />
              ) : !data?.lowStockItems?.length ? (
                <EmptyState colSpan={5} text="暂无低库存物品" />
              ) : (
                data.lowStockItems.map((i: { id: string; code: string; name: string; stock: number; minStock: number; unit: string }) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Badge className='bg-primary/10 text-primary font-mono'>{i.code}</Badge>
                    </TableCell>
                    <TableCell className='font-medium'>{i.name}</TableCell>
                    <TableCell className='text-right font-semibold text-destructive'>{i.stock}</TableCell>
                    <TableCell className='text-right text-muted-foreground'>{i.minStock}</TableCell>
                    <TableCell className='text-muted-foreground'>{i.unit}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function AppointmentTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
  const { data, isLoading, isError, refetch } = useAppointmentStatusStats(dateRange);
  const list = data ?? [];
  const total = list.reduce((s: number, i: { count: number }) => s + i.count, 0);

  return (
    <>
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>各状态预约占比</span>
            <span className='text-sm text-muted-foreground'>合计 {total} 笔</span>
          </div>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <AppointmentPieChart data={list} loading={isLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <span className='text-sm font-medium'>预约状态明细</span>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead className='text-right'>笔数</TableHead>
                <TableHead className='text-right'>占比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={3}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={3} />
              ) : list.length === 0 ? (
                <EmptyState colSpan={3} text="暂无数据" />
              ) : (
                list.map((s) => (
                  <TableRow key={s.status}>
                    <TableCell className='font-medium'>{APPOINTMENT_STATUS_LABEL[s.status as keyof typeof APPOINTMENT_STATUS_LABEL] ?? s.status}</TableCell>
                    <TableCell className='text-right'>{s.count}</TableCell>
                    <TableCell className='text-right text-muted-foreground'>{s.percentage.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function MemberTab() {
  const { data, isLoading } = useMemberStats({});

  const cards = [
    {
      label: '总会员',
      value: data?.totalMembers ?? 0,
      icon: <Users className='w-8 h-8 text-primary/30' />,
      color: 'text-primary',
    },
    {
      label: '总余额',
      value: `¥${Number(data?.totalBalance ?? 0).toFixed(2)}`,
      icon: <Wallet className='w-8 h-8 text-success/30' />,
      color: 'text-success',
    },
    {
      label: '总积分',
      value: data?.totalPoints ?? 0,
      icon: <Award className='w-8 h-8 text-warning/30' />,
      color: 'text-warning',
    },
  ];

  const levelDist = data?.levelDistribution ?? [];

  return (
    <>
      <div className='grid grid-cols-3 gap-4'>
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='text-sm text-muted-foreground'>{c.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</div>
                </div>
                {c.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <span className='text-sm font-medium'>会员等级分布</span>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <MemberLevelPieChart data={levelDist} loading={isLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>
    </>
  );
}