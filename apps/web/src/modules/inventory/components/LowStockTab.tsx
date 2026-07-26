import { TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLowStockItems } from '@/lib/api/inventory/inventory';

export function LowStockTab() {
  const { data, isLoading } = useLowStockItems();
  const items = data ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          以下物品库存已低于最低库存量，请及时补货
        </div>
        <div className="text-sm text-muted-foreground">共 {items.length} 项</div>
      </div>
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-32">分类</TableHead>
              <TableHead className="w-20 text-right">库存</TableHead>
              <TableHead className="w-24 text-right">最低库存</TableHead>
              <TableHead className="w-16">单位</TableHead>
              <TableHead>供应商</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={7} />
            ) : items.length === 0 ? (
              <EmptyState colSpan={7} text="暂无低库存物品" />
            ) : (
              items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Badge className="bg-primary/10 text-primary font-mono">{i.code}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell>
                    <Badge className="bg-muted text-muted-foreground">{i.category}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-destructive">{i.stock}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{i.minStock}</TableCell>
                  <TableCell className="text-muted-foreground">{i.unit}</TableCell>
                  <TableCell className="text-muted-foreground">{i.supplierName ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
