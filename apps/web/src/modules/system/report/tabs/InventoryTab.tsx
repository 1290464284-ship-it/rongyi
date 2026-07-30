import { Package, AlertTriangle, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { Badge } from '@/components/ui/badge';
import { useInventoryStatus } from '@/lib/api/system/stats';

export default function InventoryTab() {
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
