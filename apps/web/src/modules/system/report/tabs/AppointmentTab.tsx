import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useAppointmentStatusStats } from '@/lib/api/system/stats';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/api/clinical/appointments';
import AppointmentPieChart from '../charts/AppointmentPieChart';
import { Suspense } from 'react';

const SuspenseChart = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="text-center text-muted-foreground py-8">加载中...</div>}>
    {children}
  </Suspense>
);

export default function AppointmentTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
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
