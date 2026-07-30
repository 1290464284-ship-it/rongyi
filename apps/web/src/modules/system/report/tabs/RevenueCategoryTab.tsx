import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useRevenueByCategory } from '@/lib/api/system/stats';
import RevenueCategoryPieChart from '../charts/RevenueCategoryPieChart';
import { Suspense } from 'react';

const SuspenseChart = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="text-center text-muted-foreground py-8">加载中...</div>}>
    {children}
  </Suspense>
);

export default function RevenueCategoryTab({ dateRange }: { dateRange: { startDate: string; endDate: string } }) {
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
