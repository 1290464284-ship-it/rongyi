import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Printer, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import {
  usePrescriptions,
  useCreatePrescription,
  useDeletePrescription,
  type Prescription,
} from '@/lib/api/content/prescriptions';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { CreatePrescriptionDialog, PrescriptionPrintView } from './components/PrescriptionDialogs';

export default function PrescriptionPage() {
  const [searchParams] = useSearchParams();
  const presetPatientId = searchParams.get('patientId') ?? '';
  const presetVisitId = searchParams.get('visitId') ?? '';

  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [viewOpen, setViewOpen] = useState(false);
  const [selectedRx, setSelectedRx] = useState<Prescription | null>(null);
  const [createOpen, setCreateOpen] = useState(() => !!presetPatientId);
  const printTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = usePrescriptions({ page, pageSize });
  const createRx = useCreatePrescription();
  const deleteRx = useDeletePrescription();

  const prescriptions = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filtered = keyword
    ? prescriptions.filter(
        r =>
          r.patient?.name?.includes(keyword) ||
          r.doctor?.name?.includes(keyword) ||
          r.id.includes(keyword),
      )
    : prescriptions;

  // 组件卸载时清理打印定时器
  useEffect(() => {
    return () => {
      if (printTimerRef.current) {
        clearTimeout(printTimerRef.current);
        printTimerRef.current = null;
      }
    };
  }, []);

  function handleView(rx: Prescription) {
    setSelectedRx(rx);
    setViewOpen(true);
  }

  function handlePrint(rx: Prescription) {
    setSelectedRx(rx);
    // 先清理之前的定时器
    if (printTimerRef.current) {
      clearTimeout(printTimerRef.current);
    }
    printTimerRef.current = setTimeout(() => {
      printTimerRef.current = null;
      window.print();
    }, 100);
  }

  function handleDelete(id: string) {
    if (!confirm('确定删除该处方？')) return;
    deleteRx.mutate(id);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">处方管理</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新开处方
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索患者/医生"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>患者</TableHead>
                <TableHead>医生</TableHead>
                <TableHead>药品数</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>开方时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={6} />
              ) : filtered.length === 0 ? (
                <EmptyState colSpan={6} text="暂无数据" />
              ) : (
                filtered.map(rx => (
                  <TableRow key={rx.id}>
                    <TableCell>
                      <div className="font-medium">{rx.patient?.name}</div>
                      <div className="text-xs text-muted-foreground">{rx.patient?.phone}</div>
                    </TableCell>
                    <TableCell>{rx.doctor?.name}</TableCell>
                    <TableCell>{rx.items.length} 种</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {rx.remark || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(rx.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => handleView(rx)}>
                        <Eye className="w-3 h-3 mr-1" />
                        查看
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handlePrint(rx)}>
                        <Printer className="w-3 h-3 mr-1" />
                        打印
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(rx.id)} disabled={deleteRx.isPending}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                      {deleteRx.isPending ? '删除中…' : ''}
                    </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4">
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

      {selectedRx && (
        <>
          <Dialog open={viewOpen} onClose={() => setViewOpen(false)} className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>处方详情</DialogTitle>
            </DialogHeader>
            <DialogContent>
              <PrescriptionPrintView rx={selectedRx} />
              <div className="no-print flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setViewOpen(false)}>关闭</Button>
                <Button onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-2" />
                  打印处方
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      <CreatePrescriptionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        presetPatientId={presetPatientId}
        presetVisitId={presetVisitId}
        onCreate={createRx.mutateAsync}
        isPending={createRx.isPending}
      />
    </div>
  );
}
