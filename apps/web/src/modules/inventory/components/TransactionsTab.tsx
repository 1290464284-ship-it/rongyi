import { useState } from 'react';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
import { useInventoryItems, useInventoryTransactions } from '@/lib/api/inventory/inventory';
import { formatDateTime } from '@/lib/utils';
import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';

const TX_TYPE_LABEL: Record<string, string> = {
  IN: '入库',
  OUT: '出库',
  ADJUST: '调整',
};

const TX_TYPE_CLASS: Record<string, string> = {
  IN: 'bg-success/10 text-success',
  OUT: 'bg-destructive/10 text-destructive',
  ADJUST: 'bg-primary/10 text-primary',
};

export function TransactionsTab() {
  const [itemId, setItemId] = useState('');
  const { data, isLoading } = useInventoryTransactions(itemId || undefined);
  const { data: itemsData } = useInventoryItems({ pageSize: DROPDOWN_MAX_PAGE_SIZE });
  const items = itemsData?.items ?? [];
  const txs = data?.items ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="tx-filter-item" className="text-muted-foreground">物品</Label>
          <Select id="tx-filter-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-60">
            <option value="">全部物品</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.code})
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto text-sm text-muted-foreground">共 {txs.length} 条记录</div>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">时间</TableHead>
              <TableHead>物品名称</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead className="w-20 text-right">数量</TableHead>
              <TableHead className="w-28 text-right">单价</TableHead>
              <TableHead className="w-28 text-right">总额</TableHead>
              <TableHead className="w-24">操作员</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={8} />
            ) : txs.length === 0 ? (
              <EmptyState colSpan={8} text="暂无记录" />
            ) : (
              txs.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-muted-foreground">{formatDateTime(tx.createdAt)}</TableCell>
                  <TableCell className="font-medium">{tx.itemName ?? '-'}</TableCell>
                  <TableCell>
                    <Badge className={TX_TYPE_CLASS[tx.type]}>
                      {TX_TYPE_LABEL[tx.type] ?? tx.type}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      tx.type === 'OUT' ? 'text-destructive' : 'text-success'
                    }`}
                  >
                    {tx.type === 'OUT' ? '-' : '+'}
                    {tx.quantity}
                  </TableCell>
                  <TableCell className="text-right">¥{Number(tx.unitPrice).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-semibold">
                    ¥{Number(tx.totalAmount).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tx.operatorName ?? '-'}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.remark ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
