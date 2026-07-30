import { Users, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { usePatientGrowth } from '@/lib/api/system/stats';
import PatientGrowthChart from '../charts/PatientGrowthChart';
import { Suspense } from 'react';

const SuspenseChart = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="text-center text-muted-foreground py-8">加载中...</div>}>
    {children}
  </Suspense>
);

export default function PatientGrowthTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
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
