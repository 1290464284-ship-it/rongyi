import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import {
  useCharges,
  useCreateCharge,
  usePayCharge,
  useRefundCharge,
  CHARGE_STATUS_LABEL,
  type ChargeStatus,
  type Charge,
} from '@/lib/api/financial/charge';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { VirtualChargeRow, ROW_HEIGHT } from './components/VirtualChargeRow';
import { CreateChargeDialog } from './components/CreateChargeDialog';
import { PayDialog } from './components/payments/PayDialog';
import { RefundDialog } from './components/RefundDialog';

const ChargePage = React.memo(function ChargePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 参数读取默认值
  const [statusFilter, setStatusFilter] = useState<ChargeStatus | ''>((searchParams.get('status') as ChargeStatus) || '');
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [debouncedKeyword, setDebouncedKeyword] = useState(searchParams.get('keyword') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const pageSize = 10;
  const parentRef = useRef<HTMLDivElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);

  // 关键词变化时更新 URL
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
      const params = new URLSearchParams(searchParams);
      if (keyword) {
        params.set('keyword', keyword);
      } else {
        params.delete('keyword');
      }
      params.set('page', '1');
      setSearchParams(params, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL同步effect仅在keyword变化时触发，添加searchParams/setSearchParams会导致无限循环
  }, [keyword]);

  // 状态筛选变化时更新 URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (statusFilter) {
      params.set('status', statusFilter);
    } else {
      params.delete('status');
    }
    params.set('page', '1');
    setSearchParams(params, { replace: true });
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL同步effect仅在statusFilter变化时触发
  }, [statusFilter]);

  // 页码变化时更新 URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (page > 1) {
      params.set('page', String(page));
    } else {
      params.delete('page');
    }
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL同步effect仅在page变化时触发
  }, [page]);

  const { data, isLoading, isError, refetch } = useCharges({
    status: statusFilter || undefined,
    keyword: debouncedKeyword || undefined,
    page,
    pageSize,
  });

  const createCharge = useCreateCharge();
  const payCharge = usePayCharge();
  const refundCharge = useRefundCharge();

  const charges = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const rowVirtualizer = useVirtualizer({
    count: charges.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const handlePay = useCallback((charge: Charge) => {
    setSelectedCharge(charge);
    setPayOpen(true);
  }, []);

  const handleRefund = useCallback((charge: Charge) => {
    setSelectedCharge(charge);
    setRefundOpen(true);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">收费收银</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建收费单
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索单号/患者姓名/电话"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as ChargeStatus | '');
                setPage(1);
              }}
              className="w-36"
            >
              <option value="">全部状态</option>
              <option value="UNPAID">{CHARGE_STATUS_LABEL.UNPAID}</option>
              <option value="PARTIAL">{CHARGE_STATUS_LABEL.PARTIAL}</option>
              <option value="PAID">{CHARGE_STATUS_LABEL.PAID}</option>
              <option value="REFUNDED">{CHARGE_STATUS_LABEL.REFUNDED}</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div ref={parentRef} className="overflow-auto" style={{ height: '500px' }}>
            <Table style={{ display: 'table', width: '100%', tableLayout: 'fixed' }}>
              <TableHeader style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white' }}>
                <TableRow>
                  <TableHead style={{ width: '120px' }}>单号</TableHead>
                  <TableHead style={{ width: '150px' }}>患者</TableHead>
                  <TableHead style={{ width: '100px' }}>金额</TableHead>
                  <TableHead style={{ width: '100px' }}>已付</TableHead>
                  <TableHead style={{ width: '100px' }}>状态</TableHead>
                  <TableHead style={{ width: '100px' }}>支付方式</TableHead>
                  <TableHead style={{ width: '140px' }}>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <tbody style={{ display: 'block', height: rowVirtualizer.getTotalSize() }}>
                {isError ? (
                  <tr><td colSpan={8}><QueryErrorAlert onRetry={refetch} /></td></tr>
                ) : isLoading ? (
                  <TableLoading colSpan={8} />
                ) : charges.length === 0 ? (
                  <EmptyState colSpan={8} text="暂无收费记录" />
                ) : (
                  rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const charge = charges[virtualRow.index];
                    return (
                      <tr
                        key={charge.id}
                        ref={(el) => {
                          if (el) rowVirtualizer.measureElement(el);
                        }}
                        data-index={virtualRow.index}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                          display: 'table',
                          tableLayout: 'fixed',
                        }}
                      >
                        <VirtualChargeRow
                          charge={charge}
                          onPay={handlePay}
                          onRefund={handleRefund}
                        />
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4 px-6 pb-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateChargeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createCharge.mutateAsync}
        isPending={createCharge.isPending}
      />

      {selectedCharge && (
        <>
          <PayDialog
            open={payOpen}
            onClose={() => setPayOpen(false)}
            charge={selectedCharge}
            onPay={payCharge.mutateAsync}
            isPending={payCharge.isPending}
          />
          <RefundDialog
            open={refundOpen}
            onClose={() => setRefundOpen(false)}
            charge={selectedCharge}
            onRefund={refundCharge.mutateAsync}
            isPending={refundCharge.isPending}
          />
        </>
      )}
    </div>
  );
});
export default ChargePage;
