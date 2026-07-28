import { useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  RecordModifyRequest,
  useRecordModifyRequests,
  useReviewModifyRequest,
} from '@/lib/api/clinical/medical-records';

export function RequestsTab() {
  const [_selectedRequest, setSelectedRequest] = useState<RecordModifyRequest | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const { data: requestsData, isLoading } = useRecordModifyRequests({ page, pageSize });
  const requests = requestsData?.items ?? [];
  const total = requestsData?.total ?? 0;
  const reviewMutation = useReviewModifyRequest();

  async function handleReview(id: string, status: 'APPROVED' | 'REJECTED') {
    const remark = status === 'REJECTED' ? (prompt('请输入拒绝理由') || undefined) : undefined;
    await reviewMutation.mutateAsync({ id, data: { status, reviewRemark: remark } });
    toast.success(status === 'APPROVED' ? '已批准' : '已拒绝');
    setSelectedRequest(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h3 className="text-lg font-semibold">修改申请</h3>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>患者</TableHead>
              <TableHead>申请理由</TableHead>
              <TableHead>申请人</TableHead>
              <TableHead>申请时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
                <TableLoading colSpan={6} />
              ) : (requests ?? []).length === 0 ? (
                <EmptyState colSpan={6} text="暂无数据" />
              ) : (
              (requests ?? []).map((request: RecordModifyRequest) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">
                    {request.patient?.name || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{request.reason}</TableCell>
                  <TableCell>{request.applicant?.name || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {request.createdAt
                      ? format(new Date(request.createdAt), 'yyyy-MM-dd HH:mm', {
                          locale: zhCN,
                        })
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        request.status === 'PENDING'
                          ? 'bg-warning/10 text-warning border-warning/30'
                          : request.status === 'APPROVED'
                          ? 'bg-success/10 text-success border-success/30'
                          : 'bg-danger/10 text-danger border-danger/30'
                      }
                    >
                      {request.status === 'PENDING'
                        ? '待审核'
                        : request.status === 'APPROVED'
                        ? '已批准'
                        : '已拒绝'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {request.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReview(request.id, 'APPROVED')}
                          disabled={reviewMutation.isPending}
                        >
                          {reviewMutation.isPending ? '处理中…' : '批准'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReview(request.id, 'REJECTED')}
                          disabled={reviewMutation.isPending}
                        >
                          {reviewMutation.isPending ? '处理中…' : '拒绝'}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {total > pageSize && (
          <div className="flex items-center justify-between text-sm text-muted-foreground pt-4">
            <span>共 {total} 条</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
