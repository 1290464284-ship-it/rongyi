import { TrendingUp, BarChart3, Stethoscope, CreditCard } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useRevenue } from '@/lib/api/system/stats';
import RevenueLineChart from '../charts/RevenueLineChart';
import CategoryPieChart from '../charts/CategoryPieChart';
import PayMethodDoughnutChart from '../charts/PayMethodDoughnutChart';
import { Suspense } from 'react';

const SuspenseChart = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="text-center text-muted-foreground py-8">加载中...</div>}>
    {children}
  </Suspense>
);

export default function RevenueTab({
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
